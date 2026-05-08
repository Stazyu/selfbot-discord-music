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

        // Use faster settings for initial detection, slower for intervals
        const timeout = isInitial ? 5000 : 10000;

        const ff = spawn(ffmpeg, [
            '-nostats',
            '-hide_banner',
            '-loglevel', 'info',
            '-icy', '1',
            '-i', radioUrl,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        let isKilled = false;

        ff.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ff.on('close', (code) => {
            if (queue.radioStopped || isKilled) return;

            // Extract ICY metadata information
            const metadataMatch = stderr.match(/StreamTitle\s*:\s*(.+)/i);
            const icyGenre = stderr.match(/icy-genre\s*:\s*(.+)/i);
            const icyBr = stderr.match(/icy-br\s*:\s*(.+)/i);
            const icySr = stderr.match(/icy-sr\s*:\s*(.+)/i);
            const icyUrl = stderr.match(/icy-url\s*:\s*(.+)/i);

            let songTitle = null;
            let metadataInfo = {
                genre: icyGenre ? icyGenre[1].trim() : null,
                bitrate: icyBr ? icyBr[1].trim() : null,
                sampleRate: icySr ? icySr[1].trim() : null,
                url: icyUrl ? icyUrl[1].trim() : null
            };

            // Extract song title from metadata patterns
            if (metadataMatch) {
                songTitle = metadataMatch[1].trim();
                console.log(`[radio] StreamTitle found: ${songTitle}`);
                if (metadataInfo.genre) console.log(`[radio] Genre: ${metadataInfo.genre}`);
                if (metadataInfo.bitrate) console.log(`[radio] Bitrate: ${metadataInfo.bitrate} kbps`);
            } else {
                console.log(`[radio] No StreamTitle detected`);
            }

            if (songTitle && songTitle !== currentSong) {
                // Skip error messages and invalid content
                if (songTitle.includes('0kB other streams:0kB global headers:0kB muxing overhead: unknown') ||
                    songTitle.includes('ffmpeg') ||
                    songTitle.includes('error') ||
                    songTitle.includes('Input') ||
                    songTitle.includes('Output') ||
                    songTitle.length < 3) {
                    console.log(`[radio] Skipping invalid content: ${songTitle}`);
                    return;
                }

                currentSong = songTitle;
                lastSuccessfulDetection = Date.now();
                consecutiveErrors = 0; // Reset error counter on success
                console.log(`[radio] Detected song: ${currentSong}`);

                // Add to play history
                if (!queue.playHistory) {
                    queue.playHistory = []
                }
                queue.playHistory.unshift({
                    title: `${songTitle} (Radio)`,
                    url: queue.radioUrl,
                    playedAt: new Date().toISOString(),
                    isRadio: true
                })
                // Keep only last 10 songs in history
                if (queue.playHistory.length > 10) {
                    queue.playHistory = queue.playHistory.slice(0, 10)
                }

                // Update the radio message with current song info and metadata
                if (queue.radioMessage) {
                    console.log(`[radio] Updating message with current song: ${currentSong}`);

                    let messageText = `📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`;

                    // Add genre and bitrate info if available
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
                } else {
                    console.log(`[radio] No radio message available to update`);
                }
            } else {
                // No metadata detected, but process closed normally
                console.log('[radio] No metadata detected in this cycle');
            }
        });

        ff.on('error', (err) => {
            console.log('[radio] Metadata detection error:', err.message);
            consecutiveErrors++;

            // If too many consecutive errors, restart the metadata detection
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                console.log(`[radio] Too many consecutive errors (${consecutiveErrors}), restarting metadata detection in ${ERROR_RESTART_DELAY / 1000} seconds...`);

                if (metadataInterval) {
                    clearInterval(metadataInterval);
                    metadataInterval = null;
                }

                setTimeout(() => {
                    if (!queue.radioStopped) {
                        consecutiveErrors = 0; // Reset error counter
                        lastSuccessfulDetection = Date.now(); // Reset timestamp
                        metadataInterval = setInterval(detectMetadata, 10000);
                        console.log('[radio] Metadata detection restarted');
                    }
                }, ERROR_RESTART_DELAY);
            }
        });

        // Kill FFmpeg after timeout (faster for initial detection)
        const killTimeout = setTimeout(() => {
            isKilled = true;
            ff.kill('SIGKILL'); // Force kill
        }, timeout);

        // Clean up timeout when process closes
        ff.on('close', () => {
            clearTimeout(killTimeout);
        });
    }

    // Try to detect metadata immediately (faster initial detection)
    console.log('[radio] Starting initial metadata detection (fast mode)');
    detectMetadata(true);
    // Then check every 5 seconds for updates (slower but more thorough)
    console.log('[radio] Setting up metadata detection interval: 20000ms');
    metadataInterval = setInterval(() => detectMetadata(false), 20000);
    console.log('[radio] Metadata detection interval started');

    return {
        stop: () => {
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
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
