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

    function detectMetadata() {
        if (queue.radioStopped || !metadataInterval) {
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
            return;
        }

        // Check if metadata detection has been stuck for too long (no successful detection for 5 minutes)
        if (Date.now() - lastSuccessfulDetection > 300000) {
            console.log('[radio] Metadata detection appears stuck, restarting...');
            consecutiveErrors = MAX_CONSECUTIVE_ERRORS; // Force restart
        }

        const ff = spawn(ffmpeg, [
            '-analyzeduration', '10000000',
            '-probesize', '50000000',
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

            // Try to extract song title from FFmpeg output
            const titleMatch = stderr.match(/title\s*:\s*(.+)/i);
            const artistMatch = stderr.match(/artist\s*:\s*(.+)/i);
            const metadataMatch = stderr.match(/StreamTitle='([^']+)'/i);

            let songTitle = null;

            if (metadataMatch) {
                songTitle = metadataMatch[1];
            } else if (titleMatch && artistMatch) {
                songTitle = `${artistMatch[1]} - ${titleMatch[1]}`;
            } else if (titleMatch) {
                songTitle = titleMatch[1];
            }

            if (songTitle && songTitle !== currentSong) {
                // Skip error messages from being added to play history
                if (songTitle.includes('0kB other streams:0kB global headers:0kB muxing overhead: unknown')) {
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

                // Update the radio message with current song info
                if (queue.radioMessage) {
                    queue.radioMessage.edit(`📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`).catch(console.error);
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

        // Kill FFmpeg after 5 seconds if it doesn't finish
        const killTimeout = setTimeout(() => {
            isKilled = true;
            ff.kill('SIGKILL'); // Force kill
        }, 5000);

        // Clean up timeout when process closes
        ff.on('close', () => {
            clearTimeout(killTimeout);
        });
    }

    // Try to detect metadata immediately
    detectMetadata();
    // Then check every 10 seconds for updates
    metadataInterval = setInterval(detectMetadata, 10000);

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
