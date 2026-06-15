import { joinVoiceChannel, createAudioPlayer } from "@discordjs/voice"
import { Message, Guild, VoiceChannel } from "selfbotsdk-discordjs"
import { queues, saveState, createDefaultQueue } from "../core/queue"
import { playRadio } from "../core/player"
import { resolveRadioMetadata } from "../services/radio"
import { Queue } from "../types"

async function handleRadio(msg: Message, args: string[], guild: Guild, voice: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  const query = args.join(" ")

  if (!query) {
    msg.reply("Usage: ?radio <station name or URL>")
    return
  }

  try {
    msg.channel.send("📻 Searching for radio station...")

    const radio = await resolveRadioMetadata(query)

    msg.channel.send(`📻 Found: **${radio.name}** ${radio.country ? `(${radio.country})` : ""}`)

    if (!queue) {
      if (!voice) {
        msg.reply("Join VC dulu")
        return
      }
      const connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      })

      const player = createAudioPlayer()
      connection.subscribe(player)

      const playbackChannel = (msg.channel as any).guild
        ? msg.channel
        : (voice.guild.systemChannel || voice.guild.channels.cache.find(c => {
            const ch = c as any
            return ch.isTextBased && ch.type === 0
          }) || voice.guild.channels.cache.first())

      queue = createDefaultQueue({
        textChannel: playbackChannel as any,
        connection,
        player,
        voiceChannelId: voice.id
      })

      queues.set(guild.id, queue)
    }

    if (queue.currentProcesses) {
      queue.currentProcesses.ytdlp.kill()
      queue.currentProcesses.ff.kill()
    }

    playRadio(guild, radio.url, radio.name)

  } catch (err) {
    console.error("Radio error:", err)
    msg.reply("❌ Error: " + (err as Error).message)
  }
}

function handleRadioStats(msg: Message, queue: Queue | undefined): void {
  if (!queue || !queue.radioFfmpeg) {
    msg.reply("❌ Tidak ada radio yang sedang dimainkan")
    return
  }

  const stats = queue.radioFfmpeg.getStreamStats
    ? queue.radioFfmpeg.getStreamStats()
    : { sizeMB: "Unknown", lastRestart: "Unknown" }

  let statsMsg = `📊 **Radio Stream Statistics** 📊\n\n`
  statsMsg += `📻 **Station:** ${queue.radioName || "Unknown"}\n`
  statsMsg += `📏 **Stream Size:** ${stats.sizeMB}MB\n`
  statsMsg += `🔄 **Last Restart:** ${stats.lastRestart}\n`
  statsMsg += `🔁 **Reconnect Attempts:** ${queue.radioReconnectAttempts || 0}/5\n`
  statsMsg += `📡 **Status:** ${queue.isReconnecting ? "Reconnecting..." : "Connected"}\n`

  if (queue.metadataDetector) {
    const detectorStatus = queue.metadataDetector.getStatus()
    statsMsg += `🎵 **Metadata Detector:** Active\n`
    statsMsg += `   • Current Song: ${detectorStatus.currentSong || "No data"}\n`
    statsMsg += `   • Last Detection: ${new Date(detectorStatus.lastSuccessfulDetection).toLocaleString()}\n`
    statsMsg += `   • Consecutive Errors: ${detectorStatus.consecutiveErrors}\n`
  } else {
    statsMsg += `🎵 **Metadata Detector:** Inactive\n`
  }

  msg.channel.send(statsMsg)
}

export { handleRadio, handleRadioStats }
