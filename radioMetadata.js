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

        let isKilled = false;
        let metadataInfo = {
            genre: null,
            bitrate: null
        };
        let streamTitle = null;

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
                streamTitle = streamTitleMatch[1].trim();
                console.log("🎶 Now Playing:", streamTitle);
            }
        });

        ff.on('close', (code) => {
            if (queue.radioStopped || isKilled) return;

            if (streamTitle) {
                console.log(`[radio] StreamTitle found: ${streamTitle}`);
            } else {
                console.log(`[radio] No StreamTitle detected`);
            }

            if (streamTitle && streamTitle !== currentSong) {
                // Skip error messages and invalid content
                if (streamTitle.includes('0kB other streams:0kB global headers:0kB muxing overhead: unknown') ||
                    streamTitle.includes('ffmpeg') ||
                    streamTitle.includes('error') ||
                    streamTitle.includes('Input') ||
                    streamTitle.includes('Output') ||
                    streamTitle.length < 3) {
                    console.log(`[radio] Skipping invalid content: ${streamTitle}`);
                    return;
                }

                currentSong = streamTitle;
                lastSuccessfulDetection = Date.now();
                consecutiveErrors = 0; // Reset error counter on success
                console.log(`[radio] Detected song: ${currentSong}`);

                // Add to play history
                if (!queue.playHistory) {
                    queue.playHistory = []
                }
                queue.playHistory.unshift({
                    title: `${streamTitle} (Radio)`,
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
        ff.once('close', () => {
            clearTimeout(killTimeout);
        });
    }

    // Try to detect metadata immediately (faster initial detection)
    console.log('[radio] Starting initial metadata detection (fast mode)');
    detectMetadata(true);
    // Then check every 10 seconds for updates (slower but more thorough)
    console.log('[radio] Setting up metadata detection interval: 10000ms');
    metadataInterval = setInterval(() => detectMetadata(false), 10000);
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
