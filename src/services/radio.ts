import { spawn } from "child_process"
import https from "https"
import config from "../config"
import { isUrl } from "../utils/format"
import { RadioMetadataResult, FFmpegWithExtensions, StreamStats } from "../types"

async function resolveRadioMetadata(query: string): Promise<RadioMetadataResult> {
  if (isUrl(query)) return { url: query, name: "Direct URL" }

  const enc = encodeURIComponent(query || "music")
  const rbUrl = `https://de1.api.radio-browser.info/json/stations/byname/${enc}`

  return new Promise((resolve, reject) => {
    https.get(rbUrl, (res) => {
      let data = ""
      res.on("data", (chunk: string) => { data += chunk })
      res.on("end", () => {
        try {
          const list: Array<{ url: string; name: string; country?: string; codec?: string }> = JSON.parse(data)
          if (!Array.isArray(list) || list.length === 0) {
            reject(new Error(`No results for "${query}"`))
            return
          }
          const first = list.find((x: { url: string }) => x.url) || list[0]
          resolve({
            url: first.url,
            name: first.name || query,
            country: first.country || null,
            codec: first.codec || null
          })
        } catch (err) {
          reject(err)
        }
      })
    }).on("error", reject)
  })
}

async function detectStreamCodec(inputUrl: string): Promise<string | null> {
  return new Promise((resolve) => {
    const ff = spawn(config.ffmpeg, [
      "-analyzeduration", "5000000",
      "-probesize", "10000000",
      "-i", inputUrl,
      "-f", "null",
      "-"
    ], { stdio: ["ignore", "pipe", "pipe"] })

    let stderr = ""
    ff.stderr!.on("data", (data: Buffer) => { stderr += data.toString() })

    ff.on("close", () => {
      const audioMatch = stderr.match(/Stream #\d+:\d+.*Audio:\s*(\w+)/i)
      const codec = audioMatch ? audioMatch[1].toLowerCase() : null
      console.log(`[radio] Detected codec: ${codec || "unknown"}`)
      resolve(codec)
    })

    ff.on("error", () => resolve(null))

    setTimeout(() => {
      ff.kill()
      resolve(null)
    }, 5000)
  })
}

function spawnRadioFfmpeg(inputUrl: string, codec: string | null = null, onClose: ((code: number | null, signal: string | null) => void) | null = null): FFmpegWithExtensions {
  const args: string[] = [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-nostdin",
    "-analyzeduration", "10000000",
    "-probesize", "50000000",
    "-i", inputUrl,
    "-vn"
  ]

  if (codec === "opus") {
    args.push("-c:a", "copy")
  } else {
    args.push("-f", "ogg", "-ar", "48000", "-ac", "2", "-b:a", "128k")
  }

  args.push("pipe:1")

  const ff = spawn(config.ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] }) as FFmpegWithExtensions

  let streamSize = 0
  let lastRestartTime = Date.now()
  const MAX_STREAM_SIZE = 250 * 1024 * 1024
  const MIN_RESTART_INTERVAL = 5 * 60 * 1000

  ff.on("spawn", () => console.log("[radio] ffmpeg spawned for", inputUrl))

  ff.stdout!.on("data", (chunk: Buffer) => {
    streamSize += chunk.length
    if (streamSize > MAX_STREAM_SIZE && (Date.now() - lastRestartTime) > MIN_RESTART_INTERVAL) {
      console.log(`[radio] Stream size reached ${(streamSize / 1024 / 1024).toFixed(2)}MB, restarting to prevent broken pipe...`)
      ff.kill("SIGTERM")
      lastRestartTime = Date.now()
    }
  })

  ff.stderr!.on("data", (data: Buffer) => {
    const stderrOutput = data.toString()
    const brokenPipePatterns = [
      "Broken pipe", "av_interleaved_write_frame(): Broken pipe",
      "Connection reset by peer", "Connection timed out",
      "Network error", "Stream ended", "End of file",
      "Server returned 404", "Server returned 5",
      "Connection refused", "No route to host", "Host unreachable"
    ]

    const isBrokenPipe = brokenPipePatterns.some(pattern => stderrOutput.includes(pattern))
    if (isBrokenPipe) {
      console.log(`[radio] Stream error detected: ${stderrOutput.trim()}`)
      ff._brokenPipeDetected = true
    }

    if (!stderrOutput.includes("0kB other streams:0kB global headers:0kB muxing overhead: unknown")) {
      console.error("[radio] ffmpeg stderr:", stderrOutput)
    }
  })

  ff.on("close", (code: number | null, signal: string | null) => {
    console.log("[radio] ffmpeg closed with code", code, "signal:", signal)
    console.log(`[radio] Final stream size: ${(streamSize / 1024 / 1024).toFixed(2)}MB`)
    if (onClose) onClose(code, signal)
    if (code !== null && signal !== "SIGTERM" && signal !== "15") {
      console.error("[radio] ffmpeg exited with error code:", code)
    }
  })

  ff.on("error", (err: Error) => {
    console.error("[radio] ffmpeg process error:", err)
  })

  ff.getStreamStats = (): StreamStats => ({
    sizeMB: (streamSize / 1024 / 1024).toFixed(2),
    lastRestart: new Date(lastRestartTime + 7 * 60 * 60 * 1000).toISOString().replace("T", " ").substring(0, 19) + " WIB"
  })

  return ff
}

export { resolveRadioMetadata, detectStreamCodec, spawnRadioFfmpeg }
