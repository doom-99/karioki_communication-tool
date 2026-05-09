// --- グローバル変数 (windowに紐付けて共有可能にする) ---
window.chatMessages = [];
let isUserListening = false;
let speakingQueueCount = 0;
let isMyTyping = false;
let customDictionary = {};
let currentFontSize = 16;
let savedTtsRate = 1.0;
let savedTtsPitch = 1.0;

// YAMNet関連
let isEnvSoundActive = false;
let yamnetModel = null;
let envAudioContext = null;
let workletNode = null;
let envStream = null;
let lastCaptionTime = 0;

const isAndroid = /Android/i.test(navigator.userAgent);
const chatLog = document.getElementById('chatLog');
const sttInterim = document.getElementById('sttInterim');
const ttsInput = document.getElementById('ttsInput');

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initWebRTC(); // webrtc.jsで定義されている
    
    const saved = localStorage.getItem('chatMessages');
    if (saved) {
        try { window.chatMessages = JSON.parse(saved); renderAllMessages(); } catch(e) { window.chatMessages = []; }
    }

    if (isAndroid) document.querySelector('.meter-container').style.display = 'none';

    initUIEvents();
    initSelectionPopup();
    
    // ダークモードの初期反映
    document.body.classList.toggle('dark-mode', localStorage.getItem('darkMode') === 'true');
});

// 設定変更の監視
window.addEventListener('storage', (e) => {
    if (['userDictionary', 'appFontSize', 'ttsRate', 'ttsPitch', 'ttsVoice', 'darkMode'].includes(e.key)) {
        loadSettings();
    }
});

function loadSettings() {
    customDictionary = JSON.parse(localStorage.getItem('userDictionary')) || {};
    currentFontSize = parseInt(localStorage.getItem('appFontSize')) || 16;
    savedTtsRate = parseFloat(localStorage.getItem('ttsRate')) || 1.0;
    savedTtsPitch = parseFloat(localStorage.getItem('ttsPitch')) || 1.0;
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
    document.body.classList.toggle('dark-mode', localStorage.getItem('darkMode') === 'true');
}

// 他のファイルから呼べるようにwindowに公開
window.getMyName = function() { 
    return document.getElementById('myNameInput').value.trim() || '名無し'; 
};

// --- メッセージ操作 ---
window.addMessage = function(name, text, type) {
    const index = window.chatMessages.length;
    const msgObj = { name, text, type };
    window.chatMessages.push(msgObj);
    appendMessageToDOM(msgObj, index);
    saveMessages();
};

window.syncHistory = function(messages) {
    const myName = window.getMyName();
    window.chatMessages = (messages || []).map(m => {
        return m.name !== myName ? { name: m.name, text: m.text, type: 'remote' } : m;
    });
    renderAllMessages();
    saveMessages();
};

function renderAllMessages() {
    chatLog.innerHTML = '';
    window.chatMessages.forEach((m, i) => appendMessageToDOM(m, i));
    chatLog.scrollTop = chatLog.scrollHeight;
}

function appendMessageToDOM(m, i) {
    const MSG_STYLES = {
        tts: { bg: '#e8f5e9', border: '#66bb6a', nameColor: '#2e7d32' },
        stt: { bg: '#e3f2fd', border: '#42a5f5', nameColor: '#1565c0' },
        remote: { bg: '#fff3e0', border: '#ffa726', nameColor: '#e65100' }
    };
    let s = MSG_STYLES[m.type] || MSG_STYLES.stt;
    if (m.type === 'remote') s = getColorForName(m.name);
    const alignClass = m.type === 'remote' ? 'left' : 'right';
    const isSameSender = i > 0 && window.chatMessages[i - 1].name === m.name && window.chatMessages[i - 1].type === m.type;
    const nameHtml = isSameSender ? '' : `<span class="msg-name" style="color:${s.nameColor};">${escapeHTML(m.name)}</span>`;
    const html = `<div class="msg-row ${alignClass}"><div class="msg-wrapper">${nameHtml}<div class="msg-bubble" data-index="${i}" style="background:${s.bg}; border: 1px solid ${s.border};"><span class="msg-text">${escapeHTML(m.text)}</span></div></div></div>`;
    chatLog.insertAdjacentHTML('beforeend', html);
    chatLog.scrollTop = chatLog.scrollHeight;
}

function saveMessages() { localStorage.setItem('chatMessages', JSON.stringify(window.chatMessages)); }
function messagesToText() { return window.chatMessages.map(m => `${m.name}： ${m.text}`).join('\n'); }
function escapeHTML(str) { return str.replace(/[&<>'"]/g, t => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[t])); }
function getColorForName(n) {
    const pals = [{bg:'#fff3e0',c:'#e65100'},{bg:'#fce4ec',c:'#c2185b'},{bg:'#e3f2fd',c:'#1565c0'}];
    let h = 0; for(let i=0;i<n.length;i++) h = n.charCodeAt(i) + ((h<<5)-h);
    const p = pals[Math.abs(h)%pals.length];
    return { bg: p.bg, border: p.c, nameColor: p.c };
}

// --- 通信ダミー（webrtc.jsがない場合のエラー回避） ---
if (typeof broadcastData !== 'function') window.broadcastData = () => {};
if (typeof broadcastTypingState !== 'function') window.broadcastTypingState = () => {};

// --- マイク音量メーター ---
let audioContextMeter; 
let analyser;

async function initVolumeMeter() {
    if (audioContextMeter || isAndroid) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioContextMeter = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContextMeter.createAnalyser();
        analyser.fftSize = 256;
        const source = audioContextMeter.createMediaStreamSource(stream);
        source.connect(analyser);
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const volumeMeter = document.getElementById('volumeMeter');
        
        function updateMeter() {
            if (!isUserListening) { 
                volumeMeter.style.width = '0%'; 
                requestAnimationFrame(updateMeter); 
                return; 
            }
            analyser.getByteFrequencyData(dataArray);
            let sum = 0; 
            for(let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            
            // ★微調整: 小さな音でもメーターが動き始めるように感度を調整
            let average = sum / dataArray.length;
            let percent = Math.min(100, (average / 40) * 100); 
            
            volumeMeter.style.width = percent + '%';
            
            // 色の変化をより直感的に
            if (percent > 70) volumeMeter.style.background = '#f44336'; // 大きすぎ（赤）
            else if (percent > 5) volumeMeter.style.background = '#4caf50'; // ちょうどいい（緑）
            else volumeMeter.style.background = '#8bc34a'; // 小さい（黄緑）
            
            requestAnimationFrame(updateMeter);
        }
        updateMeter();
    } catch (err) { 
        console.log("マイク音量取得失敗", err); 
    }
}

// --- UIイベント ---
function initUIEvents() {
    // 送信
    document.getElementById('speakBtn').onclick = speakAndLog;
    
    // Enter送信
    ttsInput.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault(); speakAndLog();
        }
    });

    // 聞き取り
    const startBtn = document.getElementById('startBtn');
    startBtn.onclick = () => {
        isUserListening = !isUserListening;
        if (isUserListening) {
            startSTT();
            startBtn.textContent = '👂 停止';
            startBtn.classList.add('listening-active');
        } else {
            stopSTT();
            startBtn.textContent = '🎤 開始';
            startBtn.classList.remove('listening-active');
        }
    };

    // 待って
    const waitBtn = document.getElementById('waitBtn');
    waitBtn.onclick = () => {
        isMyTyping = !isMyTyping;
        waitBtn.classList.toggle('active', isMyTyping);
        broadcastTypingState(isMyTyping);
    };

    // リセット
    document.getElementById('clearChatBtn').onclick = () => {
        if(confirm("消去しますか？")) { window.chatMessages = []; renderAllMessages(); localStorage.removeItem('chatMessages'); }
    };
    
    // コピー・保存
    document.getElementById('copyChatBtn').onclick = () => {
        navigator.clipboard.writeText(messagesToText()).then(() => alert("コピー完了"));
    };

    // ドロワー制御
    const menuBtn = document.getElementById('mobileMenuBtn');
    const panel = document.querySelector('.sync-panel');
    const overlay = document.getElementById('drawerOverlay');
    if (menuBtn) {
        menuBtn.onclick = () => { panel.classList.add('active'); overlay.classList.add('active'); panel.open = true; };
        overlay.onclick = () => { panel.classList.remove('active'); overlay.classList.remove('active'); };
    }
}

// 他のファイルから呼ばれる指標表示
window.handleRemoteTyping = function(d) {
    const indicator = document.getElementById('typingIndicator');
    if (d.isTyping) { indicator.textContent = `🖐️ ${d.name}さんが入力中...`; indicator.style.display = 'block'; }
    else indicator.style.display = 'none';
};

// --- 音声認識 (STT) ---
let recognition = null;
let restartTimer = null;
let isApiActive = false;

function startSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = !isAndroid;

    recognition.onstart = () => { isApiActive = true; clearTimeout(restartTimer); restartTimer = null; };

    recognition.onresult = (e) => {
        let interim = ''; let final = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + '．\n\n';
            else interim += e.results[i][0].transcript;
        }
        
        final = applyDictionary(final);
        interim = applyDictionary(interim);

        if (final.trim()) {
            addMessage(getMyName(), final.trim(), 'stt');
            broadcastData(final.trim());
        }
        sttInterim.textContent = interim ? "👂: " + interim : "";
        
        const isAtBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 50;
        if (isAtBottom && (final || interim)) chatLog.scrollTop = chatLog.scrollHeight;
    };

    recognition.onerror = (e) => {
        isApiActive = false;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
            isUserListening = false;
            document.getElementById('startBtn').textContent = '🎤 聞き取り開始';
            document.getElementById('startBtn').classList.remove('listening-active');
            alert("マイクの使用が許可されていません。"); return;
        }
        if (e.error === 'aborted') return;
        scheduleRestart((e.error === 'audio-capture') ? 1000 : 250);
    };

    recognition.onend = () => { 
        isApiActive = false;
        if (isUserListening) scheduleRestart(isAndroid ? 250 : 600); 
    };
    
    try { recognition.start(); } catch(e) { scheduleRestart(1500); }
}

function scheduleRestart(delay = 600) {
    if (!isUserListening || restartTimer !== null) return;
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!isUserListening || isApiActive) return;
        startSTT();
    }, delay);
}

function stopSTT() { 
    if(recognition) recognition.stop(); 
    clearTimeout(restartTimer);
    restartTimer = null;
    sttInterim.textContent = ""; 
}

function applyDictionary(t) {
    let r = t; for(const [w, c] of Object.entries(customDictionary)) r = r.split(w).join(c);
    return r;
}

// --- 音声合成 (TTS) ---
function speakAndLog() {
    const text = ttsInput.value.trim();
    if (!text) return;
    
    if (isMyTyping) document.getElementById('waitBtn').click();
    
    addMessage(getMyName(), text, 'tts');
    broadcastData(text);
    ttsInput.value = ''; ttsInput.blur();

    const chunks = text.match(/.*?[、。，．！？\n\s]+|.{1,25}/g) || [text];
    let idx = 0; let offset = 0;
    
    function play() {
        if (idx >= chunks.length) { speakingQueueCount--; if(speakingQueueCount<=0) renderAllMessages(); return; }
        const uttr = new SpeechSynthesisUtterance(chunks[idx]);
        uttr.lang = 'ja-JP'; uttr.rate = savedTtsRate; uttr.pitch = savedTtsPitch;
        
        const savedVoice = localStorage.getItem('ttsVoice');
        if (savedVoice) {
            const v = window.speechSynthesis.getVoices().find(v => v.name === savedVoice);
            if (v) uttr.voice = v;
        }

        uttr.onstart = () => {
            if (idx === 0) speakingQueueCount++;
            const el = chatLog.querySelector(`.msg-bubble[data-index="${chatMessages.length-1}"] .msg-text`);
            if (el) {
                const chunk = chunks[idx];
                el.innerHTML = escapeHTML(text.slice(0, offset)) + `<span class="tts-highlight-word">${escapeHTML(chunk)}</span>` + escapeHTML(text.slice(offset + chunk.length));
            }
        };
        uttr.onend = () => { offset += chunks[idx].length; idx++; play(); };
        uttr.onerror = () => { offset += chunks[idx].length; idx++; play(); };
        
        setTimeout(() => window.speechSynthesis.speak(uttr), 10);
    }
    play();
}

// --- 環境音認識 (AudioWorklet版) ---
document.getElementById('envSoundToggle').onchange = async (e) => {
    isEnvSoundActive = e.target.checked;
    if (isEnvSoundActive) {
        showAudioCaption("⏳ AIモデル読込中...");
        await startEnvironmentalSoundDetection();
    } else stopEnvironmentalSoundDetection();
};

async function startEnvironmentalSoundDetection() {
    const yamDict = { 16: "😄 笑い声", 18: "😢 泣き声", 20: "👶 赤ちゃんの泣き声", 55: "👏 拍手", 71: "🐶 犬", 72: "🐶 犬", 78: "🐱 猫", 80: "🐱 猫", 300: "🌧️ 雨", 318: "⏰ アラーム", 322: "🚨 サイレン", 323: "🚑 救急車", 324: "🚒 消防車", 325: "🚓 パトカー", 382: "🪟 ガラス割れ", 386: "🛎️ チャイム", 388: "☎️ 電話", 393: "⏰ 目覚まし", 400: "🚪 ノック", 430: "⌨️ タイピング" };
    try {
        if (!yamnetModel) yamnetModel = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', {fromTFHub: true});
        envStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        envAudioContext = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        await envAudioContext.audioWorklet.addModule('js/audio-processor.js');
        const source = envAudioContext.createMediaStreamSource(envStream);
        workletNode = new AudioWorkletNode(envAudioContext, 'audio-processor');
        
        showAudioCaption("✅ 環境音の監視を開始しました");
        let isPredicting = false;

        workletNode.port.onmessage = (e) => {
            if (!isEnvSoundActive || isPredicting) return;
            isPredicting = true;
            setTimeout(() => {
                tf.tidy(() => {
                    const results = yamnetModel.execute(tf.tensor1d(e.data));
                    const topClass = results[0].max(0).argMax().dataSync()[0];
                    const topScore = results[0].max().dataSync()[0];
                    const now = Date.now();
                    if (now - lastCaptionTime > 3000) {
                        if (topScore > 0.05 && yamDict[topClass]) {
                            showAudioCaption(`🔔 ${yamDict[topClass]}`); lastCaptionTime = now;
                        } else if (topScore > 0.05 && [49, 50, 51, 56, 57, 58, 424, 425].includes(topClass)) {
                            showAudioCaption(`👏 突発音`); lastCaptionTime = now;
                        }
                    }
                });
                isPredicting = false;
            }, 0);
        };
        source.connect(workletNode); workletNode.connect(envAudioContext.destination);
    } catch(err) { console.error(err); alert("エラーが発生しました。"); document.getElementById('envSoundToggle').checked = false; }
}

function stopEnvironmentalSoundDetection() {
    if(workletNode) { workletNode.disconnect(); workletNode = null; }
    if(envAudioContext) { envAudioContext.close(); envAudioContext = null; }
    if(envStream) { envStream.getTracks().forEach(t => t.stop()); envStream = null; }
    document.getElementById('envSoundCaption').style.display = 'none';
}

function showAudioCaption(t) {
    const c = document.getElementById('envSoundCaption');
    c.textContent = t; c.style.display = 'block';
    c.style.animation = 'none'; c.offsetHeight;
    c.style.animation = 'fadeInOut 3s forwards';
}

function handleRemoteTyping(d) {
    const indicator = document.getElementById('typingIndicator');
    if (d.isTyping) { indicator.textContent = `🖐️ ${d.name}さんが入力中...`; indicator.style.display = 'block'; }
    else indicator.style.display = 'none';
}