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
        const timeout = isInitial ? 5000 : 8000;
        const analyzeDuration = isInitial ? 5000000 : 10000000;
        const probeSize = isInitial ? 5000000 : 50000000;

        const ff = spawn(ffmpeg, [
            '-analyzeduration', analyzeDuration.toString(),
            '-probesize', probeSize.toString(),
            '-i', radioUrl,
            '-f', 'null',
            '-',
            '-metadata', 'title=',
            '-metadata', 'artist='
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        let isKilled = false;

        ff.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ff.on('close', (code) => {
            if (queue.radioStopped || isKilled) return;

            // Try to extract song title from FFmpeg output with multiple patterns
            const metadataMatch = stderr.match(/StreamTitle='([^']+)'/i);
            const titleMatch = stderr.match(/title\s*:\s*(.+)/i);
            const artistMatch = stderr.match(/artist\s*:\s*(.+)/i);
            const icyMatch = stderr.match(/icy-name\s*:\s*(.+)/i);
            const titleArtistMatch = stderr.match(/(.+?)\s*-\s*(.+)/i);

            let songTitle = null;

            // Try different metadata extraction patterns
            if (metadataMatch) {
                songTitle = metadataMatch[1];
                console.log(`[radio] Metadata found via StreamTitle: ${songTitle}`);
            } else if (titleMatch && artistMatch) {
                songTitle = `${artistMatch[1]} - ${titleMatch[1]}`;
                console.log(`[radio] Metadata found via title/artist: ${songTitle}`);
            } else if (titleMatch) {
                songTitle = titleMatch[1];
                console.log(`[radio] Metadata found via title only: ${songTitle}`);
            } else if (icyMatch) {
                // Check if icy-name contains song info or just station name
                const icyName = icyMatch[1];
                // Skip if it looks like a station name (contains radio station keywords)
                // But allow if it contains song-like patterns (artist - title format)
                if (icyName.match(/FM|RADIO|STATION/i)) {
                    // Check if it might be a song with station-like words
                    if (icyName.match(/ - | – | ft\.|feat\./i)) {
                        // Likely a song title with station-like words
                        songTitle = icyName;
                        console.log(`[radio] Metadata found via icy-name (song with station words): ${songTitle}`);
                    } else {
                        console.log(`[radio] Skipping station name from icy-name: ${icyName}`);
                    }
                } else if (icyName.match(/PRAMBORS|RRI|ELSHINTA|TRAX|GEN|ARDAN|SMART|PAS|MARA/i)) {
                    // Skip specific Indonesian station names
                    console.log(`[radio] Skipping Indonesian station name from icy-name: ${icyName}`);
                } else if (icyName.length < 3) {
                    // Skip if too short (likely not a song title)
                    console.log(`[radio] Skipping too short title from icy-name: ${icyName}`);
                } else if (icyName.match(/^[0-9\s\.\-]+$/)) {
                    // Skip if only numbers/symbols (likely frequency)
                    console.log(`[radio] Skipping frequency from icy-name: ${icyName}`);
                } else {
                    songTitle = icyName;
                    console.log(`[radio] Metadata found via icy-name: ${songTitle}`);
                }
            } else if (titleArtistMatch) {
                songTitle = titleArtistMatch[0];
                console.log(`[radio] Metadata found via title-artist pattern: ${songTitle}`);
            } else {
                console.log(`[radio] No metadata patterns matched in stderr output`);
                // Log a sample of stderr for debugging (first 500 chars)
                console.log(`[radio] stderr sample: ${stderr.substring(0, 500)}...`);
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

                // Update the radio message with current song info
                if (queue.radioMessage) {
                    console.log(`[radio] Updating message with current song: ${currentSong}`);
                    queue.radioMessage.edit(`📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`)
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
                        metadataInterval = setInterval(detectMetadata, 5000);
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
    console.log('[radio] Setting up metadata detection interval: 5000ms');
    metadataInterval = setInterval(() => detectMetadata(false), 5000);
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
