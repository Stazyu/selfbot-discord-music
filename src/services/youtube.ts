import { spawn } from "child_process"
import fs from "fs"
import config from "../config"
import { YouTubeSearchResult } from "../types"

async function searchSong(query: string): Promise<YouTubeSearchResult> {
  const searchQuery = query.startsWith("https://") ? query : `ytsearch:${query}`

  console.log("Searching with yt-dlp:", searchQuery)

  return new Promise((resolve, reject) => {
    const ytdlpArgs: string[] = ["--dump-json", "--no-playlist"]

    if (fs.existsSync(config.cookiesFile)) {
      console.log("Cookie masuk")
      ytdlpArgs.push("--cookies", config.cookiesFile)
    }

    ytdlpArgs.push(searchQuery)

    const ytdlp = spawn(config.ytdlpExecutable, ytdlpArgs)

    let output = ""
    let errorOutput = ""

    ytdlp.stdout.on("data", (data: Buffer) => { output += data.toString() })
    ytdlp.stderr.on("data", (data: Buffer) => { errorOutput += data.toString() })

    ytdlp.on("close", (code: number | null) => {
      if (code !== 0 || !output) {
        console.error("yt-dlp error:", errorOutput)
        reject(new Error(`Video not found or invalid. yt-dlp exit code: ${code}`))
        return
      }

      try {
        const video: { title: string; webpage_url?: string; url?: string; duration: number; duration_string?: string } = JSON.parse(output)
        if (!video || !video.title) {
          reject(new Error("Video not found or invalid"))
          return
        }

        resolve({
          title: video.title,
          url: video.webpage_url || video.url || "",
          duration: video.duration,
          durationFormatted: video.duration_string || `${Math.floor(video.duration / 60)}:${(video.duration % 60).toString().padStart(2, '0')}`
        })
      } catch {
        reject(new Error("Failed to parse video information"))
      }
    })

    ytdlp.on("error", (err: Error) => {
      reject(new Error(`Failed to execute yt-dlp: ${err.message}`))
    })
  })
}

export { searchSong }
