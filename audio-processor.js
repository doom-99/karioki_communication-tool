// オーディオ処理専用の裏側スレッド（AudioWorklet）
class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 8192; // 判定に必要なサンプル数
        this.audioBuffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    // マイクから音のデータが流れてくるたびに実行される
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;

        const channelData = input[0];

        // データをバッファに貯める
        for (let i = 0; i < channelData.length; i++) {
            if (this.bufferIndex < this.bufferSize) {
                this.audioBuffer[this.bufferIndex++] = channelData[i];
            }
        }

        // 8192サンプル（約0.5秒分）貯まったら、メインスレッドに送る
        if (this.bufferIndex >= this.bufferSize) {
            // コピーを作成して送信
            const dataToSend = new Float32Array(this.audioBuffer);
            this.port.postMessage(dataToSend);
            
            // バッファをリセット
            this.bufferIndex = 0;
        }

        return true; // 処理を継続する
    }
}

// プロセッサを登録
registerProcessor('audio-processor', AudioProcessor);