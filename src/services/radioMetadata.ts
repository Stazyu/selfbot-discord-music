import http from "http"
import https from "https"
import { Queue, RadioMetadataDetectorStatus } from "../types"

function startRadioMetadataDetection(radioUrl: string, queue: Queue): {
  stop: () => void
  getStatus: () => RadioMetadataDetectorStatus
} {
  let currentSong: string | null = null
  let metadataInterval: NodeJS.Timeout | null = null
  let isPolling = false
  let lastSuccessfulDetection = Date.now()
  let consecutiveErrors = 0

  function poll(targetUrl: string = radioUrl, redirectCount: number = 0): void {
    if (queue.radioStopped) return
    if (isPolling && redirectCount === 0) return
    if (redirectCount === 0) isPolling = true

    if (redirectCount > 5) {
      console.error("[radio-http] Gagal: Terlalu banyak redirect")
      isPolling = false
      return
    }

    const client = targetUrl.startsWith("https") ? https : http

    const req = client.get(targetUrl, {
      headers: { "Icy-MetaData": "1" }
    }, (res) => {
      if (queue.radioStopped) {
        res.destroy()
        isPolling = false
        return
      }

      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.destroy()
        if (typeof res.headers.location === "string") {
          return poll(res.headers.location, redirectCount + 1)
        }
        isPolling = false
        return
      }

      if (res.statusCode && res.statusCode >= 400) {
        console.error(`[radio-http] Server returned status: ${res.statusCode}`)
        res.destroy()
        isPolling = false
        consecutiveErrors++
        return
      }

      const metadataInfo: { genre: string | null; bitrate: string | null } = {
        genre: res.headers["icy-genre"] ? (res.headers["icy-genre"] as string).trim() : null,
        bitrate: res.headers["icy-br"] ? (res.headers["icy-br"] as string).trim() : null
      }

      const metaint = parseInt(res.headers["icy-metaint"] as string, 10)

      if (isNaN(metaint)) {
        console.error("[radio-http] Server radio tidak mengirimkan icy-metaint (Tidak ada metadata).")
        res.destroy()
        isPolling = false
        return
      }

      let audioRead = 0
      let metaLength = 0
      let metaBuffer = ""
      let readingMeta = false
      let emptyMetaBlocks = 0

      res.on("data", (chunk: Buffer) => {
        for (let i = 0; i < chunk.length; i++) {
          if (!readingMeta) {
            audioRead++
            if (audioRead === metaint) {
              readingMeta = true
              audioRead = 0
              metaLength = -1
            }
          } else {
            if (metaLength === -1) {
              metaLength = chunk[i] * 16
              metaBuffer = ""
              if (metaLength === 0) {
                readingMeta = false
              }
            } else {
              metaBuffer += String.fromCharCode(chunk[i])
              if (metaBuffer.length === metaLength) {
                readingMeta = false
                const match = metaBuffer.match(/StreamTitle=['"](.*?)['"]/i)
                if (match && match[1]) {
                  handleNewSong(match[1].trim(), metadataInfo)
                  res.destroy()
                  return
                } else {
                  emptyMetaBlocks++
                  if (emptyMetaBlocks > 3) {
                    res.destroy()
                    return
                  }
                }
              }
            }
          }
        }
      })

      res.on("close", () => {
        isPolling = false
      })
    })

    req.on("error", (err: Error) => {
      isPolling = false
      console.error(`[radio-http] Request Error: ${err.message}`)
      if ((err as NodeJS.ErrnoException).code !== "ECONNRESET") {
        consecutiveErrors++
      }
    })

    req.setTimeout(5000, () => {
      req.destroy()
      isPolling = false
    })
  }

  function handleNewSong(newStreamTitle: string, metadataInfo: { genre: string | null; bitrate: string | null }): void {
    if (!newStreamTitle || newStreamTitle.length < 3 || newStreamTitle === currentSong) return

    console.log(`[radio-http] 🎶 Detected new song: ${newStreamTitle}`)
    currentSong = newStreamTitle
    lastSuccessfulDetection = Date.now()
    consecutiveErrors = 0

    queue.playHistory.unshift({
      title: `${currentSong} (Radio)`,
      url: queue.radioUrl || radioUrl,
      playedAt: new Date().toISOString(),
      isRadio: true
    })
    if (queue.playHistory.length > 10) queue.playHistory.length = 10

    let messageText = `📻 Now playing radio: **${queue.radioName || "Unknown"}**\n🎵 Now playing: **${currentSong}**`
    const metadataParts: string[] = []
    if (metadataInfo.genre) metadataParts.push(`Genre: ${metadataInfo.genre}`)
    if (metadataInfo.bitrate) metadataParts.push(`Bitrate: ${metadataInfo.bitrate}kbps`)
    if (metadataParts.length > 0) messageText += `\n📊 ${metadataParts.join(" • ")}`

    queue.radioMessage?.edit(messageText).catch(() => {})
  }

  console.log(`[radio-http] Starting metadata detection for: ${radioUrl}`)
  poll()

  metadataInterval = setInterval(() => {
    poll()
  }, 10000)

  return {
    stop: () => {
      console.log("[radio-http] Stopping...")
      if (metadataInterval) {
        clearInterval(metadataInterval)
        metadataInterval = null
      }
    },
    getStatus: () => ({
      currentSong,
      lastSuccessfulDetection,
      consecutiveErrors
    })
  }
}

export { startRadioMetadataDetection }
