let peer = null;
let connections = [];
let isRoomHost = true;

function initWebRTC() {
    peer = new Peer();
    const urlParams = new URLSearchParams(window.location.search);
    const inviteId = urlParams.get('room');

    peer.on('open', (id) => {
        document.getElementById('myPeerId').textContent = id;
        setupInviteButtons(id);
        if (inviteId && inviteId !== id) {
            isRoomHost = false;
            document.getElementById('targetPeerId').value = inviteId;
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
        navigator.clipboard.writeText(inviteUrl).then(() => alert("URLをコピーしました．"));
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
        setTimeout(() => {
            if (isRoomHost) conn.send({ type: 'history', messages: chatMessages, isHost: true });
            else conn.send({ type: 'request_history' });
        }, 400);
    });

    conn.on('data', (data) => {
        if (data.type === 'text') {
            addMessage(data.name || '相手', data.text.trim(), 'remote');
            connections.forEach(c => { if (c !== conn && c.open) c.send(data); });
        } else if (data.type === 'history' && data.isHost) {
            syncHistory(data.messages);
        } else if (data.type === 'request_history' && isRoomHost) {
            conn.send({ type: 'history', messages: chatMessages, isHost: true });
        } else if (data.type === 'typing') {
            handleRemoteTyping(data);
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
    const status = count > 0 ? `✅ 接続完了 (${count}台)` : `現在オフラインです`;
    document.getElementById('syncStatus').textContent = status;
    document.getElementById('syncStatusSummary').textContent = count > 0 ? `(✅ ${count}台)` : `(オフライン)`;
}

function broadcastData(text) {
    const name = getMyName();
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'text', text, name }); });
}

function broadcastTypingState(isTyping) {
    const name = getMyName() === '名無し' ? '相手' : getMyName();
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'typing', name, isTyping }); });
}