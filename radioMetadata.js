const { spawn } = require("child_process")

// Use system ffmpeg on Linux, ffmpeg-static on Windows
const ffmpeg = process.platform === "win32" ? require("ffmpeg-static") : "ffmpeg"

// Function to detect current song from radio stream metadata using FFmpeg
function startRadioMetadataDetection(radioUrl, queue) {
    let currentSong = null;
    let metadataInterval = null;

    function detectMetadata() {
        if (queue.radioStopped) {
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
            return;
        }

        const ff = spawn(ffmpeg, [
            '-analyzeduration', '10000000',
            '-probesize', '50000000',
            '-i', radioUrl,
            '-f', 'null',
            '-'
        ], { stdio: ['ignore', 'pipe', 'pipe'] });

        let stderr = '';
        ff.stderr.on('data', (data) => {
            stderr += data.toString();
        });

        ff.on('close', () => {
            if (queue.radioStopped) return;

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
                currentSong = songTitle;
                console.log(`[radio] Detected song: ${currentSong}`);

                // Update the radio message with current song info
                if (queue.radioMessage) {
                    queue.radioMessage.edit(`📻 Now playing radio: **${queue.radioName}**\n🎵 Now playing: **${currentSong}**`).catch(console.error);
                }
            }
        });

        ff.on('error', (err) => {
            console.log('[radio] Metadata detection error:', err.message);
        });

        // Kill FFmpeg after 5 seconds if it doesn't finish
        setTimeout(() => {
            ff.kill();
        }, 5000);
    }

    // Try to detect metadata immediately
    detectMetadata();
    // Then check every 10 seconds for updates
    metadataInterval = setInterval(detectMetadata, 20000);

    return {
        stop: () => {
            if (metadataInterval) {
                clearInterval(metadataInterval);
                metadataInterval = null;
            }
        }
    };
}

module.exports = { startRadioMetadataDetection }
