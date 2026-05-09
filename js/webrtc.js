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
        if (err.type === 'peer-unavailable') errorMsg = "入力されたIDの相手が見つかりません．";
        alert(errorMsg);
    });
}

function setupConnection(conn) {
    conn.on('open', () => {
        if (!connections.includes(conn)) connections.push(conn);
        updateSyncStatus();
        setTimeout(() => {
            if (isRoomHost) conn.send({ type: 'history', messages: chatMessages, isHost: true });
            else conn.send({ type: 'request_history' });
        }, 400);
    });

    conn.on('data', (data) => {
        if (data.type === 'text') {
            addMessage(data.name || '相手', data.text.trim(), 'remote');
        } else if (data.type === 'history' && data.isHost) {
            syncHistory(data.messages);
        } else if (data.type === 'request_history' && isRoomHost) {
            conn.send({ type: 'history', messages: chatMessages, isHost: true });
        } else if (data.type === 'typing') {
            handleTypingIndicator(data);
        }
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        updateSyncStatus();
    });
}

function broadcastData(text) {
    const currentName = getMyName();
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'text', text: text, name: currentName }); });
}

function broadcastTypingState(isTyping) {
    const name = getMyName() === '名無し' ? '相手' : getMyName();
    connections.forEach(conn => { if (conn.open) conn.send({ type: 'typing', name: name, isTyping: isTyping }); });
}