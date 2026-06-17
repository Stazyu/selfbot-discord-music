import { joinVoiceChannel } from "@discordjs/voice"
import { Client, Guild, VoiceChannel } from "selfbotsdk-discordjs"
import { queues, saveState } from "./queue"
import { playSong, playRadio } from "./player"
import { sendToTextChannel } from "../utils/send"

let clientRef: Client | null = null

function setClient(client: Client): void {
  clientRef = client
}

async function resumeAllMusic(): Promise<void> {
  console.log("Resuming all music/radio after reconnection...")
  let resumedCount = 0
  let failedCount = 0

  for (const [guildId, queue] of queues) {
    if (!queue.voiceChannelId) {
      console.log(`No voice channel ID stored for guild ${guildId}`)
      continue
    }

    const guild: Guild | undefined = clientRef!.guilds.cache.get(guildId)
    if (!guild) {
      console.log(`Guild ${guildId} not found in cache`)
      failedCount++
      continue
    }

    try {
      const voiceChannel = guild.channels.cache.get(queue.voiceChannelId) as VoiceChannel | undefined
      if (!voiceChannel) {
        console.log(`Voice channel ${queue.voiceChannelId} not found in guild ${guildId}`)
        failedCount++
        continue
      }

      console.log(`Rejoining voice channel: ${voiceChannel.name} (${voiceChannel.id}) for guild ${guildId}`)

      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      })

      connection.subscribe(queue.player)
      queue.connection = connection

      queue.isReconnecting = false
      queue.radioReconnectAttempts = 0
      queue.reconnectMessage = null
      queue.isMusicReconnecting = false
      queue.musicReconnectAttempts = 0
      queue.musicReconnectMessage = null

      if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
        console.log(`Resuming radio: ${queue.radioName}`)
        sendToTextChannel(queue, "🔄 Reconnecting to radio after deployment...")
        setTimeout(() => playRadio(guild, queue.radioUrl!, queue.radioName!), 3000)
        resumedCount++
      } else if (queue.songs.length > 0) {
        voiceChannel.send("Test message")
        console.log(`Resuming music queue - ${queue.songs.length} songs`)
        let posStr = ""
        if (queue.playing && queue.currentSong && !queue.currentSong.isRadio) {
          const startedAt = new Date(queue.currentSong.startedAt)
          const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)
          queue.songs[0].resumeFrom = elapsedSeconds
          posStr = ` (${Math.floor(elapsedSeconds / 60)}:${(elapsedSeconds % 60).toString().padStart(2, "0")})`
          console.log(`Resuming from ${elapsedSeconds}s for "${queue.currentSong.title}"`)
        }
        sendToTextChannel(queue, `🔄 Resuming music after deployment${posStr}...`)
        setTimeout(() => playSong(guild, queue.songs[0]), 2000)
        resumedCount++
      } else {
        console.log(`No active playback to resume for guild ${guildId}`)
      }
    } catch (err) {
      console.error(`Error resuming music for guild ${guildId}:`, err)
      sendToTextChannel(queue, "❌ Gagal reconnect setelah deployment. Silakan coba manual.")
      failedCount++
    }
  }

  console.log(`Resume summary: ${resumedCount} successful, ${failedCount} failed`)
}

function registerVoiceStateUpdateHandler(): void {
  clientRef!.on("voiceStateUpdate", (oldState: any, newState: any) => {
    if (!oldState.member) return

    if (oldState.member.id === clientRef!.user!.id && oldState.channel && !newState.channel) {
      console.log("Bot was kicked from voice channel")
      const queue = queues.get(oldState.guild.id)
      if (queue) {
        let posStr = ""
        if (queue.currentSong && !queue.currentSong.isRadio) {
          const startedAt = new Date(queue.currentSong.startedAt)
          const currentTime = new Date()
          const elapsedSeconds = Math.floor((currentTime.getTime() - startedAt.getTime()) / 1000)

          if (queue.songs && queue.songs.length > 0 && queue.songs[0]) {
            queue.songs[0].resumeFrom = elapsedSeconds
            posStr = ` (${Math.floor(elapsedSeconds / 60)}:${(elapsedSeconds % 60).toString().padStart(2, "0")})`
            console.log(`Saved resume time: ${elapsedSeconds}s${posStr} for "${queue.currentSong.title}"`)
          }
        }

        queue.voiceChannelId = oldState.channel.id
        sendToTextChannel(queue, `⚠️ Bot terkick dari VC${posStr}, mencoba rejoin dalam 5 detik...`).catch((err: any) => {
          if (err.code === 50001) {
            console.error("[voice-state] Missing Access: Bot tidak memiliki izin untuk mengirim pesan ke channel setelah terkick dari VC")
          } else {
            console.error("[voice-state] Gagal mengirim pesan setelah terkick dari VC:", err.message)
          }
        })
        setTimeout(() => {
          const guild: Guild | undefined = clientRef!.guilds.cache.get(oldState.guild.id)
          if (guild) {
            const voiceChannel = guild.channels.cache.get(oldState.channel.id) as VoiceChannel | undefined
            if (voiceChannel) {
              try {
                const connection = joinVoiceChannel({
                  channelId: voiceChannel.id,
                  guildId: guild.id,
                  adapterCreator: guild.voiceAdapterCreator,
                  selfDeaf: false,
                  selfMute: false
                })
                connection.subscribe(queue.player)
                queue.connection = connection
                sendToTextChannel(queue, "✅ Berhasil rejoin ke VC")
                queue.radioReconnectAttempts = 0
                queue.musicReconnectAttempts = 0
                queue.isMusicReconnecting = false
                queue.musicReconnectMessage = null

                if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                  playRadio(guild, queue.radioUrl, queue.radioName)
                } else if (queue.songs.length > 0) {
                  playSong(guild, queue.songs[0])
                }
              } catch (err) {
                console.error("Error rejoining voice channel:", err)
                sendToTextChannel(queue, "❌ Gagal rejoin ke VC")
              }
            } else {
              console.log("Voice channel tidak ditemukan, kemungkinan temporary channel dihapus")
              sendToTextChannel(queue, "🔄 Voice channel tidak ditemukan. State direset. Join ke voice baru untuk melanjutkan.")

              queue.voiceChannelId = null
              queue.connection = null

              if (queue.currentProcesses) {
                queue.currentProcesses.ytdlp.kill()
                queue.currentProcesses.ff.kill()
              }
              if (queue.radioFfmpeg) queue.radioFfmpeg.kill()
              if (queue.metadataDetector) {
                queue.metadataDetector.stop()
                queue.metadataDetector = undefined
              }

              queue.player.stop()
              saveState()
            }
          }
        }, 5000)
      }
    }

    if (oldState.member.id !== clientRef!.user!.id && !oldState.channel && newState.channel) {
      const queue = queues.get(newState.guild.id)
      if (queue && !queue.voiceChannelId && queue.connection === null) {
        console.log("User join ke voice channel baru, bot siap untuk resume")

        queue.voiceChannelId = newState.channel.id
        queue.textChannel = newState.channel

        sendToTextChannel(queue, "🔄 Bot siap untuk melanjutkan. Gunakan command ?play atau ?radio untuk memulai kembali.")
        saveState()
      }
    }
  })
}

export { setClient, resumeAllMusic, registerVoiceStateUpdateHandler }
