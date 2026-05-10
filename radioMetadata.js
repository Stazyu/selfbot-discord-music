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
        if (queue.radioStopped) return;
        if (isPolling && redirectCount === 0) return;
        if (redirectCount === 0) isPolling = true;

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

            // 1. TANGANI REDIRECT & ERROR
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.destroy();
                return poll(res.headers.location, redirectCount + 1);
            }
            if (res.statusCode >= 400) {
                res.destroy();
                isPolling = false;
                consecutiveErrors++;
                return;
            }

            // 2. AMBIL HEADER METADATA (TERUTAMA META-INT)
            const metadataInfo = {
                genre: res.headers['icy-genre'] ? res.headers['icy-genre'].trim() : null,
                bitrate: res.headers['icy-br'] ? res.headers['icy-br'].trim() : null
            };

            const metaint = parseInt(res.headers['icy-metaint'], 10);

            // Jika server tidak mengirimkan icy-metaint, berarti radio ini tidak mendukung metadata stream
            if (isNaN(metaint)) {
                console.error('[radio-http] Server radio tidak mengirimkan icy-metaint (Tidak ada metadata).');
                res.destroy();
                isPolling = false;
                return;
            }

            // 3. ICECAST PROTOCOL DECODER MURNI
            let audioRead = 0;
            let metaLength = 0;
            let metaBuffer = '';
            let isReadingMeta = false;
            let emptyMetaBlocks = 0; // Penghitung jika dj/radio sedang tidak menyetel judul

            res.on('data', (chunk) => {
                // Proses data byte per byte
                for (let i = 0; i < chunk.length; i++) {
                    if (!isReadingMeta) {
                        audioRead++;
                        // Jika kita sudah membaca audio sebanyak batas 'metaint', blok selanjutnya adalah metadata
                        if (audioRead === metaint) {
                            isReadingMeta = true;
                            audioRead = 0;
                            metaLength = -1; // Tandai untuk membaca panjang teks
                        }
                    } else {
                        if (metaLength === -1) {
                            // Sesuai protokol: byte pertama metadata dikali 16 adalah panjang teksnya
                            metaLength = chunk[i] * 16;
                            metaBuffer = '';
                            if (metaLength === 0) {
                                isReadingMeta = false; // Blok ini kosong
                            }
                        } else {
                            // Baca huruf demi huruf
                            metaBuffer += String.fromCharCode(chunk[i]);

                            // Jika panjang teks sudah terpenuhi
                            if (metaBuffer.length === metaLength) {
                                isReadingMeta = false;

                                // Cari judul lagu di dalam teks bersih
                                const match = metaBuffer.match(/StreamTitle=['"](.*?)['"]/i);

                                if (match && match[1]) {
                                    const newStreamTitle = match[1].trim();
                                    handleNewSong(newStreamTitle, metadataInfo);

                                    // BERHASIL! Langsung hancurkan koneksi untuk hemat RAM/CPU
                                    res.destroy();
                                    return; // Keluar dari loop for
                                } else {
                                    // Judul kosong di blok ini
                                    emptyMetaBlocks++;
                                    // Jika sudah 3x cek dan tetap tidak ada judul, putus koneksi agar tidak hang
                                    if (emptyMetaBlocks > 3) {
                                        res.destroy();
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }
            });

            res.on('close', () => {
                isPolling = false;
            });
        });

        req.on('error', (err) => {
            isPolling = false;
            if (err.code !== 'ECONNRESET') {
                consecutiveErrors++;
            }
        });

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
                // Specific handling for "Unknown Message" error
                if (err.message.includes('Unknown Message')) {
                    console.log('[radio-http] Radio message not found (Unknown Message), creating new message...');
                    if (queue.textChannel) {
                        queue.textChannel.send(messageText).then(newMessage => {
                            queue.radioMessage = newMessage;
                            console.log('[radio-http] Successfully created new radio message');
                        }).catch(sendErr => {
                            console.error(`[radio-http] Failed to create new radio message:`, sendErr.message);
                        });
                    }
                } else {
                    // Log other errors but don't create new message
                    console.error(`[radio-http] Failed to update radio message:`, err.message);
                }
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
