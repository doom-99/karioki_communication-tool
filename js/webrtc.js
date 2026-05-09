let peer = null;
let connections = [];
let isRoomHost = true; // デフォルトはホスト

function initWebRTC() {
    peer = new Peer();
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('room');

    peer.on('open', (id) => {
        document.getElementById('myPeerId').textContent = id;
        setupInviteButtons(id);
        
        // URLにroomが含まれていればゲストとして接続
        if (inviteId && inviteId !== id) {
            isRoomHost = false; 
            document.getElementById('targetPeerId').value = inviteId;
            // 接続ボタンを自動クリック
            setTimeout(() => document.getElementById('connectBtn').click(), 800);
        }
    });

    peer.on('connection', (conn) => setupConnection(conn));

    peer.on('error', (err) => {
        let errorMsg = "通信エラーが発生しました．";
        if (err.type === 'peer-unavailable') errorMsg = "相手のIDが見つかりません．";
        alert(errorMsg);
        document.getElementById('syncStatus').textContent = '⚠️ エラー';
    });
}

function setupInviteButtons(id) {
    const inviteUrl = window.location.origin + window.location.pathname + '?room=' + id;
    const copyBtn = document.getElementById('copyUrlBtn');
    const qrBtn = document.getElementById('showQrBtn');
    
    copyBtn.style.display = 'inline-block';
    qrBtn.style.display = 'inline-block';

    copyBtn.onclick = () => {
        navigator.clipboard.writeText(inviteUrl).then(() => alert("招待URLをコピーしました．"));
    };

    qrBtn.onclick = () => {
        const container = document.getElementById('qrContainer');
        if (container.style.display === 'block') {
            container.style.display = 'none';
            qrBtn.textContent = '📱 QR表示';
        } else {
            container.style.display = 'block';
            qrBtn.textContent = '📱 閉じる';
            document.getElementById('qrcode').innerHTML = '';
            new QRCode(document.getElementById("qrcode"), { text: inviteUrl, width: 150, height: 150 });
        }
    };
}

function setupConnection(conn) {
    conn.on('open', () => {
        if (!connections.includes(conn)) connections.push(conn);
        updateSyncStatusUI();
        
        // ★修正: 接続直後に履歴をやり取りする
        setTimeout(() => {
            if (isRoomHost) {
                // ホストなら現在の履歴を送信
                conn.send({ 
                    type: 'history', 
                    messages: window.chatMessages, // window経由で参照
                    isHost: true 
                });
            } else {
                // ゲストならホストに履歴を要求
                conn.send({ type: 'request_history' });
            }
        }, 500);
    });

    conn.on('data', (data) => {
        if (data.type === 'text') {
            // app.jsのaddMessageを呼び出す
            if (window.addMessage) {
                window.addMessage(data.name || '相手', data.text.trim(), 'remote');
            }
            // 他の接続先にも転送
            connections.forEach(c => { if (c !== conn && c.open) c.send(data); });
        } 
        else if (data.type === 'request_history') {
            if (isRoomHost) {
                conn.send({ type: 'history', messages: window.chatMessages, isHost: true });
            }
        } 
        else if (data.type === 'history') {
            if (data.isHost && window.syncHistory) {
                window.syncHistory(data.messages);
            }
        } 
        else if (data.type === 'typing') {
            if (window.handleRemoteTyping) {
                window.handleRemoteTyping(data);
            }
            connections.forEach(c => { if (c !== conn && c.open) c.send(data); });
        }
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        updateSyncStatusUI();
    });
}

function updateSyncStatusUI() {
    const count = connections.length;
    const statusText = count > 0 ? `✅ 接続完了 (${count}台)` : `現在オフラインです`;
    document.getElementById('syncStatus').textContent = statusText;
    document.getElementById('syncStatusSummary').textContent = count > 0 ? `(✅ ${count}台)` : `(オフライン)`;
}

// app.jsから呼ばれる関数
function broadcastData(text) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'text', text, name }); });
}

function broadcastTypingState(isTyping) {
    const name = window.getMyName ? window.getMyName() : '名無し';
    const currentName = name === '名無し' ? '相手' : name;
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'typing', name: currentName, isTyping }); });
}