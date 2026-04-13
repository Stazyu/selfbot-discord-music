const { spawn } = require("child_process")
const yts = require("yt-search")
const ffmpeg = require("ffmpeg-static")
const YouTubeVideoId = require('youtube-video-id').default;

const ytdlpExecutable = process.platform === "win32" ? "./yt-dlp.exe" : "yt-dlp"

async function searchSong(query) {

    if (query.startsWith("https://")) {

        const res = await yts({ videoId: YouTubeVideoId(query) })
        const video = res
        console.log("Video : ", video)
        return {
            title: video.title,
            url: video.url,
            duration: video.timestamp
        }
    }
    const res = await yts(query)

    const video = res.videos[0]
    console.log("Video : ", video)

    return {
        title: video.title,
        url: video.url,
        duration: video.timestamp
    }
}

function stream(url) {

    const ytdlp = spawn(ytdlpExecutable, [
        "-f",
        "bestaudio",
        "-o",
        "-",
        url
    ])

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
