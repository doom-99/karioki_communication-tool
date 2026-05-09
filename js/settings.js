// --- 初期化処理 ---
document.addEventListener('DOMContentLoaded', () => {
    initVoiceList();
    initSliders();
    initFontSize();
    initDictionary();
    checkUrlParams(); // メイン画面からの単語追加リクエストを確認
});

// --- トースト通知の制御 ---
let toastTimer = null;
function showSaveToast() {
    const toast = document.getElementById('saveToast');
    toast.style.display = 'block';
    toast.style.animation = 'none';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.style.animation = 'fadeOut 1s forwards';
        setTimeout(() => { toast.style.display = 'none'; }, 1000);
    }, 2000);
}

// --- 文字サイズ設定 ---
function initFontSize() {
    let currentSize = parseInt(localStorage.getItem('appFontSize')) || 16;
    const display = document.getElementById('currentFontSizeDisplay');
    display.textContent = currentSize;

    document.getElementById('fontIncreaseBtn').onclick = () => updateFont(2);
    document.getElementById('fontDecreaseBtn').onclick = () => updateFont(-2);

    function updateFont(delta) {
        currentSize = Math.min(32, Math.max(12, currentSize + delta));
        localStorage.setItem('appFontSize', currentSize);
        display.textContent = currentSize;
        showSaveToast();
    }
}

// --- 音声設定 ---
function initVoiceList() {
    const synth = window.speechSynthesis;
    const voiceSelect = document.getElementById('voiceSelect');
    
    function populate() {
        const voices = synth.getVoices().filter(v => v.lang.includes('ja'));
        voiceSelect.innerHTML = voices.map((v, i) => 
            `<option value="${v.name}">${v.name}</option>`
        ).join('');
        
        const saved = localStorage.getItem('ttsVoice');
        if (saved) voiceSelect.value = saved;
    }

    populate();
    if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = populate;
    }

    voiceSelect.onchange = () => {
        localStorage.setItem('ttsVoice', voiceSelect.value);
        showSaveToast();
    };
}

// --- 辞書機能のリファクタリング ---
function initDictionary() {
    let dict = JSON.parse(localStorage.getItem('userDictionary')) || {};
    const list = document.getElementById('dictList');
    const wrongInput = document.getElementById('dictWrong');
    const correctInput = document.getElementById('dictCorrect');

    function render() {
        const entries = Object.entries(dict);
        list.innerHTML = entries.length ? entries.map(([w, c]) => `
            <li class="dict-item">
                <span><b>${w}</b> ➔ ${c}</span>
                <button class="dict-delete-btn" data-word="${w}">削除</button>
            </li>
        `).join('') : '<li class="dict-item no-data">登録なし</li>';

        // 削除ボタンのイベント登録
        list.querySelectorAll('.dict-delete-btn').forEach(btn => {
            btn.onclick = () => {
                delete dict[btn.dataset.word];
                save();
            };
        });
    }

    document.getElementById('addDictBtn').onclick = () => {
        const w = wrongInput.value.trim();
        const c = correctInput.value.trim();
        if (w && c) {
            dict[w] = c;
            wrongInput.value = ''; correctInput.value = '';
            save();
        }
    };

    function save() {
        localStorage.setItem('userDictionary', JSON.stringify(dict));
        render();
        showSaveToast();
    }

    render();
}

// メイン画面から ?addWord=... で送られてきた場合の処理
function checkUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const word = params.get('addWord');
    if (word) {
        document.getElementById('dictWrong').value = word;
        document.getElementById('dictCorrect').focus();
        window.history.replaceState({}, '', window.location.pathname);
    }
}