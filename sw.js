const CACHE_NAME = 'comm-tool-cache-v1';

// キャッシュしておくローカルファイルのリスト
const urlsToCache = [
    './',
    './index.html',
    './settings.html',
    './css/style.css',
    './js/app.js',
    './js/webrtc.js',
    './js/settings.js',
    './js/audio-processor.js',
    './manifest.json'
];

// インストール時にファイルをキャッシュする
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(urlsToCache))
    );
});

// オフライン時はキャッシュからファイルを返す
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                // キャッシュにデータがあればそれを返す、なければネットワーク通信を行う
                return response || fetch(event.request);
            })
    );
});