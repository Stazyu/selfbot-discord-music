const { spawn } = require("child_process")

// Use system ffmpeg on Linux, ffmpeg-static on Windows
const ffmpeg = process.platform === "win32" ? require("ffmpeg-static") : "ffmpeg"

// Function to detect current song from radio stream metadata using FFmpeg
const { spawn } = require('child_process');

function startRadioMetadataDetection(radioUrl, queue) {
    let currentSong = null;
    let ffProcess = null;
    let restartTimeout = null;
    let lastSuccessfulDetection = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    function startFfmpegStream() {
        if (queue.radioStopped) {
            console.log('[radio] Radio stopped, halting metadata detection.');
            return;
        }

        console.log('[radio] Starting/Restarting FFmpeg metadata listener...');

        // Bunuh process lama jika masih ada (mencegah leak)
        if (ffProcess && !ffProcess.killed) {
            ffProcess.kill('SIGKILL');
        }

        ffProcess = spawn('ffmpeg', [
            '-nostats',
            '-hide_banner',
            '-loglevel', 'info',
            '-icy', '1',
            '-i', radioUrl,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let metadataInfo = { genre: null, bitrate: null };
        let outputBuffer = ''; // Buffer untuk mencegah chunk terpotong

        ffProcess.stderr.on('data', (data) => {
            outputBuffer += data.toString();

            // Proses per baris (\n atau \r)
            let lines = outputBuffer.split(/\r?\n/);

            // Simpan elemen terakhir (yang mungkin belum lengkap) kembali ke buffer
            outputBuffer = lines.pop();

            for (const line of lines) {
                // Ekstrak Genre
                const genreMatch = line.match(/icy-genre\s*:\s*(.+)/i);
                if (genreMatch) metadataInfo.genre = genreMatch[1].trim();

                // Ekstrak Bitrate
                const bitrateMatch = line.match(/icy-br\s*:\s*(.+)/i);
                if (bitrateMatch) metadataInfo.bitrate = bitrateMatch[1].trim();

                // Ekstrak StreamTitle (Lagu yang sedang diputar)
                const streamTitleMatch = line.match(/StreamTitle\s*:\s*(.+)/i);
                if (streamTitleMatch) {
                    const newStreamTitle = streamTitleMatch[1].trim();
                    handleNewSong(newStreamTitle, metadataInfo);
                }
            }
        });

        ffProcess.on('close', (code) => {
            if (queue.radioStopped) return;
            console.log(`[radio] FFmpeg listener closed with code: ${code}. Restarting in 5s...`);
            scheduleRestart();
        });

        ffProcess.on('error', (err) => {
            if (queue.radioStopped) return;
            console.error('[radio] FFmpeg error:', err.message);
            consecutiveErrors++;

            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.error('[radio] Max consecutive errors reached. Pausing detection longer.');
                scheduleRestart(30000); // Tunggu 30 detik jika error beruntun
            } else {
                scheduleRestart(5000);
            }
        });
    }

    function scheduleRestart(delay = 5000) {
        if (restartTimeout) clearTimeout(restartTimeout);
        restartTimeout = setTimeout(() => {
            startFfmpegStream();
        }, delay);
    }

    function handleNewSong(newStreamTitle, metadataInfo) {
        // Filter sampah dari output ffmpeg
        const isInvalid = ['0kB other streams', 'ffmpeg', 'error', 'Input', 'Output']
            .some(keyword => newStreamTitle.includes(keyword));

        if (isInvalid || newStreamTitle.length < 3 || newStreamTitle === currentSong) return;

        console.log(`[radio] 🎶 Detected new song: ${newStreamTitle}`);
        currentSong = newStreamTitle;
        lastSuccessfulDetection = Date.now();
        consecutiveErrors = 0; // Reset error counter

        // 1. Update History
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
                console.error(`[radio] Failed to update radio message:`, err.message);
            });
        }
    }

    // --- Inisialisasi Pertama ---
    startFfmpegStream();

    return {
        stop: () => {
            console.log('[radio] Stopping metadata detection manually...');
            queue.radioStopped = true;
            if (restartTimeout) clearTimeout(restartTimeout);
            if (ffProcess && !ffProcess.killed) ffProcess.kill('SIGKILL');
        },
        getStatus: () => ({
            currentSong,
            lastSuccessfulDetection,
            consecutiveErrors,
            isRunning: ffProcess && !ffProcess.killed
        })
    };
}

module.exports = { startRadioMetadataDetection }
