// --- グローバル変数 ---
let chatMessages = [];
let isUserListening = false;
let isEnvSoundActive = false;
let yamnetModel = null;
let envAudioContext = null;
let workletNode = null;

// --- 初期化 ---
window.addEventListener('DOMContentLoaded', () => {
    loadInitialData();
    initWebRTC(); // webrtc.js
    initDOMEvents();
    window.addEventListener('storage', (e) => {
        if (['userDictionary', 'appFontSize', 'ttsRate', 'ttsPitch', 'ttsVoice'].includes(e.key)) loadSettings();
    });
});

// --- STT/TTS 核心ロジック (AudioWorklet版) ---
async function startEnvironmentalSoundDetection() {
    try {
        if (!yamnetModel) yamnetModel = await tf.loadGraphModel('https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1', {fromTFHub: true});
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false } });
        envAudioContext = new AudioContext({ sampleRate: 16000 });
        await envAudioContext.audioWorklet.addModule('js/audio-processor.js');
        const source = envAudioContext.createMediaStreamSource(stream);
        workletNode = new AudioWorkletNode(envAudioContext, 'audio-processor');
        
        workletNode.port.onmessage = (event) => {
            if (isEnvSoundActive) runYAMNetInference(event.data);
        };
        source.connect(workletNode);
        workletNode.connect(envAudioContext.destination);
    } catch (err) {
        console.error("YAMNet起動失敗", err);
    }
}

// ※ 他の appendMessageToDOM, speakAndLog などの関数は index_ver18.html から移植