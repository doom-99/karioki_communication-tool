let chatMessages = [];
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

const chatLog = document.getElementById('chatLog');
const sttInterim = document.getElementById('sttInterim');
const ttsInput = document.getElementById('ttsInput');

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    initWebRTC(); // webrtc.js
    
    const saved = localStorage.getItem('chatMessages');
    if (saved) {
        try { chatMessages = JSON.parse(saved); renderAllMessages(); } catch(e) { chatMessages = []; }
    }

    initUIEvents();
});

window.addEventListener('storage', (e) => {
    if (['userDictionary', 'appFontSize', 'ttsRate', 'ttsPitch', 'ttsVoice'].includes(e.key)) loadSettings();
});

function loadSettings() {
    customDictionary = JSON.parse(localStorage.getItem('userDictionary')) || {};
    currentFontSize = parseInt(localStorage.getItem('appFontSize')) || 16;
    savedTtsRate = parseFloat(localStorage.getItem('ttsRate')) || 1.0;
    savedTtsPitch = parseFloat(localStorage.getItem('ttsPitch')) || 1.0;
    document.documentElement.style.setProperty('--font-size', currentFontSize + 'px');
}

function getMyName() { 
    return document.getElementById('myNameInput').value.trim() || '名無し'; 
}

// --- メッセージ描画 ---
function addMessage(name, text, type) {
    const index = chatMessages.length;
    const msgObj = { name, text, type };
    chatMessages.push(msgObj);
    appendMessageToDOM(msgObj, index);
    saveMessages();
}

function renderAllMessages() {
    chatLog.innerHTML = '';
    chatMessages.forEach((m, i) => appendMessageToDOM(m, i));
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

    const isSameSender = i > 0 && chatMessages[i - 1].name === m.name && chatMessages[i - 1].type === m.type;
    const nameHtml = isSameSender ? '' : `<span class="msg-name" style="color:${s.nameColor};">${escapeHTML(m.name)}</span>`;

    const html = `<div class="msg-row ${alignClass}"><div class="msg-wrapper">${nameHtml}<div class="msg-bubble" data-index="${i}" style="background:${s.bg}; border: 1px solid ${s.border};"><span class="msg-text">${escapeHTML(m.text)}</span></div></div></div>`;
    
    chatLog.insertAdjacentHTML('beforeend', html);
    const isAtBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 50;
    if (isAtBottom || i === chatMessages.length - 1) chatLog.scrollTop = chatLog.scrollHeight;
}

function syncHistory(messages) {
    const myName = getMyName() === '名無し' ? 'あなた' : getMyName();
    chatMessages = (messages || []).map(m => {
        return m.name !== myName ? { name: m.name, text: m.text, type: 'remote' } : m;
    });
    renderAllMessages();
    saveMessages();
}

function saveMessages() { localStorage.setItem('chatMessages', JSON.stringify(chatMessages)); }
function escapeHTML(str) { return str.replace(/[&<>'"]/g, tag => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[tag])); }
function getColorForName(n) {
    const pals = [{bg:'#fff3e0',c:'#e65100'},{bg:'#fce4ec',c:'#c2185b'},{bg:'#e3f2fd',c:'#1565c0'}];
    let h = 0; for(let i=0;i<n.length;i++) h = n.charCodeAt(i) + ((h<<5)-h);
    const p = pals[Math.abs(h)%pals.length];
    return { bg: p.bg, border: p.c, nameColor: p.c };
}

// --- 音声認識 (STT) ---
function initUIEvents() {
    const startBtn = document.getElementById('startBtn');
    const waitBtn = document.getElementById('waitBtn');

    startBtn.onclick = () => {
        if (!isUserListening) {
            isUserListening = true;
            startSTT();
            startBtn.textContent = '👂 聞き取り中... (停止)';
            startBtn.classList.add('listening-active');
        } else {
            isUserListening = false;
            stopSTT();
            startBtn.textContent = '🎤 聞き取り開始';
            startBtn.classList.remove('listening-active');
        }
    };

    waitBtn.onclick = () => {
        isMyTyping = !isMyTyping;
        waitBtn.classList.toggle('active', isMyTyping);
        waitBtn.textContent = isMyTyping ? '🛑 入力中(解除)' : '🖐️ 待って';
        broadcastTypingState(isMyTyping);
    };

    document.getElementById('speakBtn').onclick = speakAndLog;
    
    document.getElementById('clearChatBtn').onclick = () => {
        if(confirm("履歴を消去しますか？")) { chatMessages = []; renderAllMessages(); localStorage.removeItem('chatMessages'); }
    };
}

let recognition = null;
function startSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'ja-JP';
    recognition.interimResults = true;
    recognition.continuous = !/Android/i.test(navigator.userAgent);

    recognition.onresult = (e) => {
        let interim = ''; let final = '';
        for (let i = e.resultIndex; i < e.results.length; ++i) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript + '．\n';
            else interim += e.results[i][0].transcript;
        }
        if (final.trim()) {
            addMessage(getMyName(), applyDictionary(final), 'stt');
            broadcastData(final);
        }
        sttInterim.textContent = interim ? "👂: " + applyDictionary(interim) : "";
    };

    recognition.onend = () => { if (isUserListening) recognition.start(); };
    recognition.start();
}
function stopSTT() { if(recognition) recognition.stop(); sttInterim.textContent = ""; }
function applyDictionary(t) {
    let r = t; for(const [w, c] of Object.entries(customDictionary)) r = r.split(w).join(c);
    return r;
}

// --- 音声合成 (TTS) ---
function speakAndLog() {
    const text = ttsInput.value.trim();
    if (!text) return;
    addMessage(getMyName(), text, 'tts');
    broadcastData(text);
    ttsInput.value = ''; ttsInput.blur();

    const chunks = text.match(/.*?[、。！？\n]+|.{1,25}/g) || [text];
    let idx = 0; let offset = 0;
    
    function play() {
        if (idx >= chunks.length) { speakingQueueCount--; if(speakingQueueCount<=0) renderAllMessages(); return; }
        const uttr = new SpeechSynthesisUtterance(chunks[idx]);
        uttr.lang = 'ja-JP'; uttr.rate = savedTtsRate; uttr.pitch = savedTtsPitch;
        
        uttr.onstart = () => {
            if (idx === 0) speakingQueueCount++;
            const el = chatLog.querySelector(`.msg-bubble[data-index="${chatMessages.length-1}"] .msg-text`);
            if (el) {
                const chunk = chunks[idx];
                el.innerHTML = escapeHTML(text.slice(0, offset)) + `<span class="tts-highlight-word">${escapeHTML(chunk)}</span>` + escapeHTML(text.slice(offset + chunk.length));
            }
        };
        uttr.onend = () => { offset += chunks[idx].length; idx++; play(); };
        window.speechSynthesis.speak(uttr);
    }
    play();
}

// --- 環境音認識 (AudioWorklet版) ---
document.getElementById('envSoundToggle').onchange = async (e) => {
    isEnvSoundActive = e.target.checked;
    if (isEnvSoundActive) await startEnvironmentalSoundDetection();
    else stopEnvironmentalSoundDetection();
};

async function startEnvironmentalSoundDetection() {
    const yamDict = { 20: "👶 赤ちゃん", 71: "🐶 犬", 322: "🚨 サイレン", 386: "🛎️ チャイム", 400: "🚪 ノック" };
    try {
        if (!yamnetModel) yamnetModel = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', {fromTFHub: true});
        envStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        envAudioContext = new AudioContext({ sampleRate: 16000 });
        await envAudioContext.audioWorklet.addModule('js/audio-processor.js');
        const source = envAudioContext.createMediaStreamSource(envStream);
        workletNode = new AudioWorkletNode(envAudioContext, 'audio-processor');
        workletNode.port.onmessage = (e) => {
            tf.tidy(() => {
                const results = yamnetModel.execute(tf.tensor1d(e.data));
                const top = results[0].max(0).argMax().dataSync()[0];
                const score = results[0].max().dataSync()[0];
                if (score > 0.1 && yamDict[top] && Date.now() - lastCaptionTime > 3000) {
                    showAudioCaption("🔔 " + yamDict[top]); lastCaptionTime = Date.now();
                }
            });
        };
        source.connect(workletNode); workletNode.connect(envAudioContext.destination);
    } catch(e) { console.error(e); }
}

function stopEnvironmentalSoundDetection() {
    if(workletNode) workletNode.disconnect();
    if(envAudioContext) envAudioContext.close();
    document.getElementById('envSoundCaption').style.display = 'none';
}

function showAudioCaption(t) {
    const c = document.getElementById('envSoundCaption');
    c.textContent = t; c.style.display = 'block';
    setTimeout(() => c.style.display = 'none', 3000);
}

function handleRemoteTyping(d) {
    const indicator = document.getElementById('typingIndicator');
    if (d.isTyping) { indicator.textContent = `🖐️ ${d.name}さんが入力中...`; indicator.style.display = 'block'; }
    else indicator.style.display = 'none';
}