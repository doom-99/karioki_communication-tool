document.addEventListener('DOMContentLoaded', () => {
    initFontSize();
    initVoices();
    initDictionary();
    initDarkMode(); // ★これを追加
});

function showToast() {
    const t = document.getElementById('saveToast');
    t.style.display = 'block';
    setTimeout(() => t.style.display = 'none', 2000);
}

function initFontSize() {
    let size = parseInt(localStorage.getItem('appFontSize')) || 16;
    const disp = document.getElementById('currentFontSizeDisplay');
    disp.textContent = size;
    document.getElementById('fontIncreaseBtn').onclick = () => { size += 2; save(); };
    document.getElementById('fontDecreaseBtn').onclick = () => { size -= 2; save(); };
    function save() { localStorage.setItem('appFontSize', size); disp.textContent = size; showToast(); }
}

function initVoices() {
    const sel = document.getElementById('voiceSelect');
    const rate = document.getElementById('rateSlider');
    const pitch = document.getElementById('pitchSlider');

    function load() {
        const vs = window.speechSynthesis.getVoices().filter(v => v.lang.includes('ja'));
        sel.innerHTML = vs.map(v => `<option value="${v.name}">${v.name}</option>`).join('');
        sel.value = localStorage.getItem('ttsVoice') || "";
    }
    load();
    window.speechSynthesis.onvoiceschanged = load;
    sel.onchange = () => { localStorage.setItem('ttsVoice', sel.value); showToast(); };
    
    rate.oninput = () => { localStorage.setItem('ttsRate', rate.value); document.getElementById('rateValue').textContent = rate.value; };
    pitch.oninput = () => { localStorage.setItem('ttsPitch', pitch.value); document.getElementById('pitchValue').textContent = pitch.value; };
}

function initDictionary() {
    let dict = JSON.parse(localStorage.getItem('userDictionary')) || {};
    const list = document.getElementById('dictList');
    function render() {
        list.innerHTML = Object.entries(dict).map(([w, c]) => `<li>${w} ➔ ${c} <button onclick="delDict('${w}')">削除</button></li>`).join('');
    }
    document.getElementById('addDictBtn').onclick = () => {
        const w = document.getElementById('dictWrong').value;
        const c = document.getElementById('dictCorrect').value;
        if(w && c) { dict[w] = c; localStorage.setItem('userDictionary', JSON.stringify(dict)); render(); showToast(); }
    };
    window.delDict = (w) => { delete dict[w]; localStorage.setItem('userDictionary', JSON.stringify(dict)); render(); showToast(); };
    render();
}

// --- ダークモード設定 ---
function initDarkMode() {
    const toggle = document.getElementById('darkModeToggle');
    const isDark = localStorage.getItem('darkMode') === 'true';
    
    // 現在の保存状態を反映
    toggle.checked = isDark;
    document.body.classList.toggle('dark-mode', isDark);

    // スイッチ切り替え時の処理
    toggle.addEventListener('change', (e) => {
        const darkOn = e.target.checked;
        localStorage.setItem('darkMode', darkOn);
        document.body.classList.toggle('dark-mode', darkOn);
        showToast();
    });
}