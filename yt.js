const { spawn } = require("child_process")
const yts = require("yt-search")
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

    if (query.startsWith("https://")) {

        const res = await yts({ videoId: YouTubeVideoId(query) })
        const video = res
        console.log("Video : ", video)

        if (!video || !video.title) {
            throw new Error("Video not found or invalid")
        }

        return {
            title: video.title,
            url: video.url,
            duration: parseTimestampToSeconds(video.timestamp),
            durationFormatted: video.timestamp
        }
    }
    const res = await yts(query)

    const video = res.videos[0]

    if (!video || !video.title) {
        throw new Error("No videos found for the search query")
    }

    return {
        title: video.title,
        url: video.url,
        duration: parseTimestampToSeconds(video.timestamp),
        durationFormatted: video.timestamp
    }
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
