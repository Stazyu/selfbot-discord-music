import { joinVoiceChannel, createAudioPlayer } from "@discordjs/voice"
import { Message, Guild, VoiceChannel, Channel } from "selfbotsdk-discordjs"
import { queues, saveState, createDefaultQueue } from "../core/queue"
import { playSong, playRadio } from "../core/player"
import { removeAllReactionsFromChannel, createCommandPanel } from "../ui/reactions"
import config from "../config"
import { Queue } from "../types"
import { sendMsg } from "../utils/send"

function handleTest(msg: Message): Promise<Message> {
  console.log("Test : ", msg)
  return msg.reply("Test command working!")
}

function handleHelp(msg: Message): void {
  const helpEmbed = [
    "🎵 **Music Selfbot Commands** 🎵",
    "",
    "**?play** <song name> - Search and play a song",
    "**?play** <single URL> - Play a single YouTube video",
    "**?play** <playlist URL> [limit] - Play a YouTube playlist (optional limit)",
    "**?play** <URL1 URL2 URL3...> - Play multiple URLs (space-separated)",
    "**?skip** - Skip the current song",
    "**?loop** - Toggle loop mode (Off/Single/All)",
    "**?shuffle** - Shuffle the current queue",
    "**?queue** - Show current queue and loop mode",
    "**?stop** - Stop playing and clear queue",
    "**?volume** [0-100] - Set or check playback volume",
    "**?radio** <station name or URL> - Play a radio station",
    "**?radiostats** - Show radio stream statistics",
    "**?clearchat** [number] - Delete messages in text channel (default 100, max 100)",
    "**?leave** - Leave voice channel and clear queue",
    "**?join** <voice_channel_id> - Join voice channel by ID",
    "**?sync** - Sync channel ID dan auto-join ke voice channel saat ini",
    "**?state** - Show current bot state",
    "**?panel** - Show control panel with reaction UI",
    "**?silent** - Toggle silent mode (message hanya di DM)",
    "**?help** - Show this help message",
    "",
    "*You must be in a voice channel to use these commands*",
    "*Commands can also be used in DMs when the bot is already in a voice channel*"
  ].join("\n")

  msg.channel.send(helpEmbed)
}

async function handleLeave(msg: Message, guild: Guild | undefined, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    await sendMsg(msg, queue, "Bot belum join ke voice channel")
    return
  }

  if (queue.currentProcesses) {
    queue.currentProcesses.ytdlp.kill()
    queue.currentProcesses.ff.kill()
  }
  if (queue.radioFfmpeg) queue.radioFfmpeg.kill()
  if (queue.metadataDetector) {
    queue.metadataDetector.stop()
    queue.metadataDetector = undefined
  }
  if (queue.reactionCollector) {
    queue.reactionCollector.stop()
    queue.reactionCollector = null
  }

  await sendMsg(msg, queue, "👋 Keluar dari voice channel")
  queue.songs = []
  queue.player.stop()
  queue.connection?.destroy()
  if (guild) queues.delete(guild.id)
  saveState()
}

async function handleClearChat(msg: Message, args: string[], queue: Queue | undefined): Promise<void> {
  if (!queue) {
    await sendMsg(msg, queue, "Bot belum join ke voice channel")
    return
  }

  const textChannel = msg.channel as any
  const isDM = !textChannel.guild

  const targetChannel = isDM ? queue.textChannel : textChannel
  if (!targetChannel) {
    await sendMsg(msg, queue, "Tidak ada text channel target")
    return
  }

  const countArg = args[0]
  let limit = 100
  if (countArg) {
    limit = parseInt(countArg)
    if (isNaN(limit) || limit < 1) {
      await sendMsg(msg, queue, "Masukkan angka yang valid")
      return
    }
    if (limit > 100) {
      await sendMsg(msg, queue, "Maksimal 100 pesan")
      return
    }
  }

  try {
    await sendMsg(msg, queue, `🗑️ Menghapus ${limit} pesan terakhir dari text channel server...`)

    const messages = await targetChannel.messages.fetch({ limit })
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

    const messagesToDelete = messages.filter((m: any) => m.createdTimestamp > twoWeeksAgo && m.author.id === msg.client.user!.id)

    if (messagesToDelete.size === 0) {
      await sendMsg(msg, queue, "ℹ️ Tidak ada pesan yang bisa dihapus (pesan lebih dari 14 hari tidak bisa dihapus)")
      return
    }

    let deletedCount = 0
    for (const [, message] of messagesToDelete) {
      try {
        await message.delete()
        deletedCount++
      } catch (err) {
        console.error("Error deleting message:", err)
      }
    }

    await sendMsg(msg, queue, `✅ Berhasil menghapus **${deletedCount}** pesan dari text channel server`)
  } catch (err) {
    console.error("Error deleting messages:", err)
    await sendMsg(msg, queue, "❌ Gagal menghapus pesan: " + (err as Error).message)
  }
}

async function handleClearReactions(msg: Message, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    await sendMsg(msg, queue, "Bot belum join ke voice channel")
    return
  }

  const textChannel = queue.textChannel
  if (!textChannel) {
    await sendMsg(msg, queue, "Tidak ada text channel terkait")
    return
  }

  if (!textChannel.guild) {
    await sendMsg(msg, queue, "❌ Command ini tidak bisa digunakan di DM. Gunakan di server text channel.")
    return
  }

  try {
    await sendMsg(msg, queue, "🧹 Menghapus semua reaction dari text channel server...")
    await removeAllReactionsFromChannel(textChannel)
    await sendMsg(msg, queue, "✅ Semua reaction berhasil dihapus dari text channel server")
  } catch (err) {
    console.error("Error clearing reactions:", err)
    await sendMsg(msg, queue, "❌ Gagal menghapus reaction: " + (err as Error).message)
  }
}

async function handleSync(msg: Message, args: string[], guild: Guild, voice: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    await sendMsg(msg, queue, "❌ Tidak ada queue yang aktif. Gunakan command ?play atau ?radio terlebih dahulu.")
    return
  }

  if (!voice) {
    await sendMsg(msg, queue, "❌ Kamu harus berada di voice channel!")
    return
  }

  if (!msg.member) {
    await sendMsg(msg, queue, "❌ Command ini tidak bisa digunakan di DM. Gunakan di server text channel.")
    return
  }

  try {
    queue.voiceChannelId = voice.id
    queue.textChannel = msg.channel as any
    queue.userId = msg.author.id

    if (queue.connection) queue.connection.destroy()

    const connection = joinVoiceChannel({
      channelId: voice.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    })

    connection.subscribe(queue.player)
    queue.connection = connection

    await sendMsg(msg, queue, "✅ Channel ID berhasil di-sync dan bot sudah join ke voice channel!")

    if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
      playRadio(guild, queue.radioUrl, queue.radioName)
    } else if (queue.songs && queue.songs.length > 0) {
      playSong(guild, queue.songs[0])
    }

    saveState()
  } catch (err) {
    console.error("Error syncing channel:", err)
    await sendMsg(msg, queue, "❌ Gagal sync channel: " + (err as Error).message)
  }
}

async function handleJoin(msg: Message, args: string[], guild: Guild, voice: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  if (!voice) {
    await sendMsg(msg, queue, "Join VC dulu")
    return
  }

  try {
    if (queue && queue.connection) queue.connection.destroy()

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

    if (!queue) {
      queue = createDefaultQueue({
        textChannel: playbackChannel as any,
        connection,
        player,
        voiceChannelId: voice.id,
        userId: msg.author.id
      })
      queues.set(guild.id, queue!)
    } else {
      queue.connection = connection
      queue.voiceChannelId = voice.id
      queue.textChannel = playbackChannel as any
      queue.userId = msg.author.id
      connection.subscribe(queue.player)
    }

    if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
      playRadio(guild, queue.radioUrl, queue.radioName)
    } else if (queue.songs && queue.songs.length > 0) {
      playSong(guild, queue.songs[0])
    }

    saveState()
    await sendMsg(msg, queue, `✅ Bot berhasil join ke voice channel: **${voice.name}**`)

  } catch (err) {
    console.error("Error joining voice channel:", err)
    await sendMsg(msg, queue, "❌ Gagal join ke voice channel: " + (err as Error).message)
  }
}

function handleState(msg: Message): void {
  let stateMsg = "📊 **Current Bot State**\n\n"

  if (queues.size === 0) {
    stateMsg += "❌ No active queues"
  } else {
    for (const [guildId, queue] of queues) {
      const guild = msg.client.guilds.cache.get(guildId)
      const guildName = guild ? guild.name : "Unknown Guild"
      stateMsg += `🏠 **Guild:** ${guildName} (${guildId})\n`

      const voiceChannel = guild?.channels.cache.get(queue.voiceChannelId || "") as VoiceChannel | undefined
      const voiceChannelName = voiceChannel ? voiceChannel.name : queue.voiceChannelId
      const textChannelName = queue.textChannel?.name || queue.textChannel?.id || "N/A"

      stateMsg += `   📢 **Voice Channel:** ${voiceChannelName} (${queue.voiceChannelId})\n`
      stateMsg += `   💬 **Text Channel:** ${textChannelName} (${queue.textChannel?.id || "N/A"})\n`
      stateMsg += `   🔊 **Volume:** ${Math.round((queue.volume ?? 1.0) * 100)}%\n`

      if (queue.songs && queue.songs.length > 0 && queue.radioStopped) {
        const currentSong = queue.songs[0]
        let nowPlayingInfo = `🎶 **Now Playing:** ${currentSong?.title || "Unknown Song"}`

        if (currentSong?.duration) {
          const currentTime = queue.currentSong && !queue.currentSong.isRadio
            ? Math.floor((Date.now() - new Date(queue.currentSong.startedAt).getTime()) / 1000)
            : 0

          const formatTime = (seconds: number): string => {
            const mins = Math.floor(seconds / 60)
            const secs = Math.floor(seconds % 60)
            return `${mins}:${secs.toString().padStart(2, "0")}`
          }

          nowPlayingInfo += ` (${formatTime(currentTime)}/${formatTime(currentSong.duration)})`
        }

        stateMsg += `   ${nowPlayingInfo}\n`
      } else if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
        stateMsg += `   📻 **Now Playing Radio:** ${queue.radioName}\n`
      } else {
        stateMsg += `   ⏸️ **Now Playing:** Nothing\n`
      }

      if (queue.radioUrl && queue.radioName) {
        stateMsg += `   📻 **Radio:** ${queue.radioName}\n`
        stateMsg += `   📻 **Radio URL:** ${queue.radioUrl}\n`
        stateMsg += `   ⏸️ **Radio Stopped:** ${queue.radioStopped ? "Yes" : "No"}\n`
      }

      if (queue.songs && queue.songs.length > 0) {
        stateMsg += `   🎵 **Songs in Queue:** ${queue.songs.length}\n`
        queue.songs.slice(0, 5).forEach((song, index) => {
          stateMsg += `      ${index + 1}. ${song?.title || "Unknown Song"}\n`
        })
        if (queue.songs.length > 5) {
          stateMsg += `      ... and ${queue.songs.length - 5} more\n`
        }
      } else {
        stateMsg += `   🎵 **Songs in Queue:** 0\n`
      }

      if (queue.playHistory && queue.playHistory.length > 0) {
        stateMsg += `   📜 **Recently Played (Last 5):**\n`
        queue.playHistory.slice(0, 5).forEach((song, index) => {
          const playTime = new Date(song.playedAt).toLocaleTimeString("id-ID", {
            hour: "2-digit",
            minute: "2-digit"
          })
          stateMsg += `      ${index + 1}. ${song?.title || "Unknown Song"} (${playTime})\n`
        })
      } else {
        stateMsg += `   📜 **Recently Played:** None\n`
      }

      stateMsg += "\n"
    }
  }

  stateMsg += `\n💾 **State File:** ${config.stateFile}`
  stateMsg += `\n✅ **Total Active Queues:** ${queues.size}`

  msg.channel.send(stateMsg)
}

function handlePanel(msg: Message, queue: Queue | undefined): void {
  if (!queue) {
    sendMsg(msg, queue, "❌ Bot belum join ke voice channel. Gunakan command ?play atau ?radio terlebih dahulu.")
    return
  }
  createCommandPanel(msg, queue)
}

async function handleSilent(msg: Message, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    sendMsg(msg, queue, "❌ Tidak ada queue aktif. Join voice channel dulu.")
    return
  }

  queue.silent = !queue.silent
  queue.userId = msg.author.id
  saveState()

  if (queue.silent) {
    await sendMsg(msg, queue, "🔇 Mode silent **ON** - Semua pesan akan dikirim ke DM")
  } else {
    await msg.channel.send("🔊 Mode silent **OFF** - Pesan akan dikirim ke channel")
  }
}

export {
  handleTest,
  handleHelp,
  handleLeave,
  handleClearChat,
  handleClearReactions,
  handleSync,
  handleJoin,
  handleState,
  handlePanel,
  handleSilent
}
