const { spawn } = require("child_process")
const ffmpeg = require("ffmpeg-static")
const YouTubeVideoId = require('youtube-video-id').default;

const ytdlpExecutable = process.platform === "win32" ? "./yt-dlp.exe" : "yt-dlp"

function parseTimestampToSeconds(timestamp) {
    if (!timestamp) return null
    const parts = timestamp.split(':')
    if (parts.length === 2) {
        return parseInt(parts[0]) * 60 + parseInt(parts[1])
    } else if (parts.length === 3) {
        return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2])
    }
    return null
}

async function searchSong(query) {
    let searchQuery = query

    if (query.startsWith("https://")) {
        searchQuery = query
    } else {
        searchQuery = `ytsearch:${query}`
    }

    return new Promise((resolve, reject) => {
        const ytdlpArgs = [
            "--dump-json",
            "--no-playlist",
            searchQuery
        ]

        const ytdlp = spawn(ytdlpExecutable, ytdlpArgs)

        let output = ""
        let errorOutput = ""

        ytdlp.stdout.on("data", (data) => {
            output += data.toString()
        })

        ytdlp.stderr.on("data", (data) => {
            errorOutput += data.toString()
        })

        ytdlp.on("close", (code) => {
            if (code !== 0 || !output) {
                reject(new Error("Video not found or invalid"))
                return
            }

            try {
                const video = JSON.parse(output)

                if (!video || !video.title) {
                    reject(new Error("Video not found or invalid"))
                    return
                }

                resolve({
                    title: video.title,
                    url: video.webpage_url || video.url,
                    duration: video.duration,
                    durationFormatted: video.duration_string || `${Math.floor(video.duration / 60)}:${(video.duration % 60).toString().padStart(2, '0')}`
                })
            } catch (err) {
                reject(new Error("Failed to parse video information"))
            }
        })

        ytdlp.on("error", (err) => {
            reject(new Error(`Failed to execute yt-dlp: ${err.message}`))
        })
    })
}

function stream(url) {
    const fs = require('fs')
    const path = require('path')

    const ytdlpArgs = [
        "-f",
        "bestaudio",
        "-o",
        "-"
    ]

    // Add cookies file if it exists
    const cookiesFile = path.join(__dirname, 'cookies.txt')
    if (fs.existsSync(cookiesFile)) {
        ytdlpArgs.push("--cookies", cookiesFile)
    }

    ytdlpArgs.push(url)

    const ytdlp = spawn(ytdlpExecutable, ytdlpArgs)

    const ff = spawn(ffmpeg, [
        "-i",
        "pipe:0",
        "-f",
        "opus",
        "-ar",
        "48000",
        "-ac",
        "2",
        "pipe:1"
    ])

    ytdlp.stdout.pipe(ff.stdin)

    return ff.stdout
}

module.exports = { searchSong, stream }
