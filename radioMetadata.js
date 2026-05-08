// Function to detect current song from radio stream metadata using FFmpeg
const http = require('http');
const https = require('https');

function startRadioMetadataDetection(radioUrl, queue) {
    let currentSong = null;
    let metadataInterval = null;
    let isPolling = false;
    let lastSuccessfulDetection = Date.now();
    let consecutiveErrors = 0;

    function poll(targetUrl = radioUrl, redirectCount = 0) {
        // Hentikan jika radio sudah di-stop
        if (queue.radioStopped) return;

        // Cegah eksekusi bertumpuk
        if (isPolling && redirectCount === 0) return;
        if (redirectCount === 0) isPolling = true;

        // Cegah Infinite Redirect Loop
        if (redirectCount > 5) {
            console.error(`[radio-http] Gagal: Terlalu banyak redirect`);
            isPolling = false;
            return;
        }

        const client = targetUrl.startsWith('https') ? https : http;

        const req = client.get(targetUrl, {
            headers: { 'Icy-MetaData': '1' }
        }, (res) => {
            if (queue.radioStopped) {
                res.destroy();
                isPolling = false;
                return;
            }

            // 1. TANGANI REDIRECT (301, 302, 307, 308)
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                console.log(`[radio-http] 🔀 Redirecting ke: ${res.headers.location}`);
                res.destroy();
                return poll(res.headers.location, redirectCount + 1);
            }

            // 2. TANGANI ERROR SERVER
            if (res.statusCode >= 400) {
                console.error(`[radio-http] ❌ Server Error Status: ${res.statusCode}`);
                res.destroy();
                isPolling = false;
                consecutiveErrors++;
                return;
            }

            // 3. AMBIL METADATA HEADER (Statis)
            const metadataInfo = {
                genre: res.headers['icy-genre'] ? res.headers['icy-genre'].trim() : null,
                bitrate: res.headers['icy-br'] ? res.headers['icy-br'].trim() : null
            };

            let buffer = '';

            // 4. BACA STREAM UNTUK MENCARI JUDUL LAGU
            res.on('data', (chunk) => {
                buffer += chunk.toString('latin1');

                const match = buffer.match(/StreamTitle=['"](.*?)['"];/i);

                if (match) {
                    const newStreamTitle = match[1].trim();
                    handleNewSong(newStreamTitle, metadataInfo);

                    // LANGSUNG PUTUS KONEKSI SETELAH DAPAT JUDUL (Hemat RAM/CPU)
                    res.destroy();
                }

                // Putus paksa jika data > 200KB tidak ada judul (agar tidak bocor memori)
                if (buffer.length > 200000) {
                    res.destroy();
                }
            });

            res.on('close', () => {
                isPolling = false;
            });
        });

        // 5. PENANGANAN ERROR JARINGAN
        req.on('error', (err) => {
            isPolling = false;
            // Abaikan error ECONNRESET karena itu hasil dari res.destroy() kita sendiri
            if (err.code !== 'ECONNRESET') {
                console.error('[radio-http] Request error:', err.message);
                consecutiveErrors++;
            }
        });

        // 6. TIMEOUT JIKA SERVER RADIO MENGGANTUNG
        req.setTimeout(5000, () => {
            req.destroy();
            isPolling = false;
        });
    }

    function handleNewSong(newStreamTitle, metadataInfo) {
        // Abaikan jika judul kosong atau tidak berubah
        if (!newStreamTitle || newStreamTitle.length < 3 || newStreamTitle === currentSong) return;

        console.log(`[radio-http] 🎶 Detected new song: ${newStreamTitle}`);
        currentSong = newStreamTitle;
        lastSuccessfulDetection = Date.now();
        consecutiveErrors = 0; // Reset counter error

        // 1. Update Play History
        if (!queue.playHistory) queue.playHistory = [];
        queue.playHistory.unshift({
            title: `${currentSong} (Radio)`,
            url: queue.radioUrl,
            playedAt: new Date().toISOString(),
            isRadio: true
        });
        if (queue.playHistory.length > 10) queue.playHistory.length = 10; // Lebih efisien dari slice

        // 2. Update Discord Message
        if (queue.radioMessage) {
            let messageText = `📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`;

            const metadataParts = [];
            if (metadataInfo.genre) metadataParts.push(`Genre: ${metadataInfo.genre}`);
            if (metadataInfo.bitrate) metadataParts.push(`Bitrate: ${metadataInfo.bitrate}kbps`);

            if (metadataParts.length > 0) {
                messageText += `\n📊 ${metadataParts.join(' • ')}`;
            }

            queue.radioMessage.edit(messageText).catch(err => {
                console.error(`[radio-http] Failed to update radio message:`, err.message);
            });
        }
    }

    // --- Inisialisasi Pertama ---
    console.log('[radio-http] Starting HTTP metadata detection...');
    poll();

    // --- Interval Polling (Setiap 10 Detik) ---
    metadataInterval = setInterval(() => {
        poll();
    }, 10000);

    return {
        stop: () => {
            console.log('[radio-http] Stopping metadata detection manually...');
            queue.radioStopped = true;
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
        },
        getStatus: () => ({
            currentSong,
            lastSuccessfulDetection,
            consecutiveErrors,
            isRunning: !!metadataInterval && !queue.radioStopped
        })
    };
}

module.exports = { startRadioMetadataDetection }
