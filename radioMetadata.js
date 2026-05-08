const { spawn } = require("child_process")

// Use system ffmpeg on Linux, ffmpeg-static on Windows
const ffmpeg = process.platform === "win32" ? require("ffmpeg-static") : "ffmpeg"

// Function to detect current song from radio stream metadata using FFmpeg
function startRadioMetadataDetection(radioUrl, queue) {
    let currentSong = null;
    let metadataInterval = null;
    let lastSuccessfulDetection = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;
    const ERROR_RESTART_DELAY = 30000; // 30 seconds

    function detectMetadata(isInitial = false) {
        console.log(`[radio] Metadata detection cycle started (${isInitial ? 'initial' : 'interval'})`);
        if (queue.radioStopped) {
            console.log('[radio] Metadata detection stopped');
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
            return;
        }

        // Check if radio FFmpeg process is still alive and valid
        if (!queue.radioFfmpeg || queue.radioFfmpeg.killed) {
            console.log('[radio] Radio FFmpeg process is not available or killed, stopping metadata detection');
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
            return;
        }
        // Allow first detection even if interval not set yet
        if (!metadataInterval && Date.now() - lastSuccessfulDetection > 10000) {
            console.log('[radio] Interval not available but continuing detection');
        }

        // Check if metadata detection has been stuck for too long (no successful detection for 5 minutes)
        if (Date.now() - lastSuccessfulDetection > 300000) {
            console.log('[radio] Metadata detection appears stuck, restarting...');
            consecutiveErrors = MAX_CONSECUTIVE_ERRORS; // Force restart
        }

        const ff = spawn(ffmpeg, [
            '-nostats',
            '-hide_banner',
            '-loglevel', 'info',
            '-icy', '1',
            '-i', radioUrl,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let metadataInfo = {
            genre: null,
            bitrate: null
        };

        ff.stderr.on('data', (data) => {
            const output = data.toString();

            // Extract icy-genre
            const genreMatch = output.match(/icy-genre\s*:\s*(.+)/i);
            if (genreMatch) {
                metadataInfo.genre = genreMatch[1].trim();
                console.log("🎵 Genre:", metadataInfo.genre);
            }

            // Extract icy-br (bitrate)
            const bitrateMatch = output.match(/icy-br\s*:\s*(.+)/i);
            if (bitrateMatch) {
                metadataInfo.bitrate = bitrateMatch[1].trim();
                console.log("🔊 Bitrate:", metadataInfo.bitrate);
            }

            // Extract StreamTitle
            const streamTitleMatch = output.match(/StreamTitle\s*:\s*(.+)/i);
            if (streamTitleMatch) {
                const newStreamTitle = streamTitleMatch[1].trim();
                console.log("🎶 Now Playing:", newStreamTitle);

                // Update message immediately when new song is detected
                if (newStreamTitle && newStreamTitle !== currentSong) {
                    // Skip error messages and invalid content
                    if (newStreamTitle.includes('0kB other streams:0kB global headers:0kB muxing overhead: unknown') ||
                        newStreamTitle.includes('ffmpeg') ||
                        newStreamTitle.includes('error') ||
                        newStreamTitle.includes('Input') ||
                        newStreamTitle.includes('Output') ||
                        newStreamTitle.length < 3) {
                        console.log(`[radio] Skipping invalid content: ${newStreamTitle}`);
                        return;
                    }

                    currentSong = newStreamTitle;
                    lastSuccessfulDetection = Date.now();
                    consecutiveErrors = 0;
                    console.log(`[radio] Detected song: ${currentSong}`);

                    // Add to play history
                    if (!queue.playHistory) {
                        queue.playHistory = []
                    }
                    queue.playHistory.unshift({
                        title: `${currentSong} (Radio)`,
                        url: queue.radioUrl,
                        playedAt: new Date().toISOString(),
                        isRadio: true
                    })
                    if (queue.playHistory.length > 10) {
                        queue.playHistory = queue.playHistory.slice(0, 10)
                    }

                    // Update the radio message with current song info and metadata
                    if (queue.radioMessage) {
                        console.log(`[radio] Updating message with current song: ${currentSong}`);

                        let messageText = `📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`;

                        if (metadataInfo.genre || metadataInfo.bitrate) {
                            const metadataParts = [];
                            if (metadataInfo.genre) metadataParts.push(`Genre: ${metadataInfo.genre}`);
                            if (metadataInfo.bitrate) metadataParts.push(`Bitrate: ${metadataInfo.bitrate}kbps`);
                            messageText += `\n📊 ${metadataParts.join(' • ')}`;
                        }

                        queue.radioMessage.edit(messageText)
                            .then(() => {
                                console.log(`[radio] Successfully updated radio message`);
                            })
                            .catch(err => {
                                console.error(`[radio] Failed to update radio message:`, err);
                            });
                    }
                }
            }
        });

        ff.on('close', (code) => {
            if (queue.radioStopped) return;
            console.log(`[radio] FFmpeg closed with code: ${code}`);
        });

        ff.on('error', (err) => {
            console.log('[radio] Metadata detection error:', err.message);

            // Restart FFmpeg if error occurs
            if (!queue.radioStopped) {
                setTimeout(() => {
                    if (!queue.radioStopped) {
                        console.log('[radio] Restarting FFmpeg after error...');
                        detectMetadata(false);
                    }
                }, 5000);
            }
        });
    }

    // Start metadata detection (real-time + interval refresh)
    console.log('[radio] Starting metadata detection (real-time + interval mode)');
    detectMetadata(true);

    // Add interval to refresh metadata every 10 seconds
    metadataInterval = setInterval(() => detectMetadata(false), 10000);
    console.log('[radio] Metadata detection interval started: 10000ms');

    return {
        stop: () => {
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
            console.log('[radio] Metadata detection stopped');
        },
        getStatus: () => ({
            currentSong,
            lastSuccessfulDetection,
            consecutiveErrors,
            isRunning: !!metadataInterval
        })
    };
}

module.exports = { startRadioMetadataDetection }
