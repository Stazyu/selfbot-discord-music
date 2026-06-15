import { joinVoiceChannel, createAudioPlayer } from "@discordjs/voice"
import { Message, Guild, VoiceChannel, Channel } from "selfbotsdk-discordjs"
import { queues, saveState, createDefaultQueue } from "../core/queue"
import { playSong, playRadio } from "../core/player"
import { removeAllReactionsFromChannel, createCommandPanel } from "../ui/reactions"
import config from "../config"
import { Queue } from "../types"

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
    "**?help** - Show this help message",
    "",
    "*You must be in a voice channel to use these commands*",
    "*Commands can also be used in DMs when the bot is already in a voice channel*"
  ].join("\n")

  msg.channel.send(helpEmbed)
}

function handleLeave(msg: Message, guild: Guild | undefined, queue: Queue | undefined): void {
  if (!queue) {
    msg.reply("Bot belum join ke voice channel")
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

  msg.channel.send("👋 Keluar dari voice channel")
  queue.songs = []
  queue.player.stop()
  queue.connection?.destroy()
  if (guild) queues.delete(guild.id)
  saveState()
}

async function handleClearChat(msg: Message, args: string[], queue: Queue | undefined): Promise<void> {
  if (!queue) {
    msg.reply("Bot belum join ke voice channel")
    return
  }

  const textChannel = queue.textChannel
  if (!textChannel) {
    msg.reply("Tidak ada text channel terkait")
    return
  }

  if (!textChannel.guild) {
    msg.reply("❌ Command ini tidak bisa digunakan di DM. Gunakan di server text channel.")
    return
  }

  const countArg = args[0]
  let limit = 100
  if (countArg) {
    limit = parseInt(countArg)
    if (isNaN(limit) || limit < 1) {
      msg.reply("Masukkan angka yang valid")
      return
    }
    if (limit > 100) {
      msg.reply("Maksimal 100 pesan")
      return
    }
  }

  try {
    msg.channel.send(`🗑️ Menghapus ${limit} pesan terakhir dari text channel server...`)

    const messages = await textChannel.messages.fetch({ limit })
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

    const messagesToDelete = messages.filter(m => m.createdTimestamp > twoWeeksAgo && m.author.id === msg.client.user!.id)

    if (messagesToDelete.size === 0) {
      msg.channel.send("ℹ️ Tidak ada pesan yang bisa dihapus (pesan lebih dari 14 hari tidak bisa dihapus)")
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

    msg.channel.send(`✅ Berhasil menghapus **${deletedCount}** pesan dari text channel server`)
  } catch (err) {
    console.error("Error deleting messages:", err)
    msg.channel.send("❌ Gagal menghapus pesan: " + (err as Error).message)
  }
}

async function handleClearReactions(msg: Message, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    msg.reply("Bot belum join ke voice channel")
    return
  }

  const textChannel = queue.textChannel
  if (!textChannel) {
    msg.reply("Tidak ada text channel terkait")
    return
  }

  if (!textChannel.guild) {
    msg.reply("❌ Command ini tidak bisa digunakan di DM. Gunakan di server text channel.")
    return
  }

  try {
    msg.channel.send("🧹 Menghapus semua reaction dari text channel server...")
    await removeAllReactionsFromChannel(textChannel)
    msg.channel.send("✅ Semua reaction berhasil dihapus dari text channel server")
  } catch (err) {
    console.error("Error clearing reactions:", err)
    msg.channel.send("❌ Gagal menghapus reaction: " + (err as Error).message)
  }
}

async function handleSync(msg: Message, args: string[], guild: Guild, voice: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  if (!queue) {
    msg.reply("❌ Tidak ada queue yang aktif. Gunakan command ?play atau ?radio terlebih dahulu.")
    return
  }

  if (!voice) {
    msg.reply("❌ Kamu harus berada di voice channel!")
    return
  }

  if (!msg.member) {
    msg.reply("❌ Command ini tidak bisa digunakan di DM. Gunakan di server text channel.")
    return
  }

  try {
    queue.voiceChannelId = voice.id
    queue.textChannel = msg.channel as any

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

    msg.channel.send("✅ Channel ID berhasil di-sync dan bot sudah join ke voice channel!")

    if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
      playRadio(guild, queue.radioUrl, queue.radioName)
    } else if (queue.songs && queue.songs.length > 0) {
      playSong(guild, queue.songs[0])
    }

    saveState()
  } catch (err) {
    console.error("Error syncing channel:", err)
    msg.reply("❌ Gagal sync channel: " + (err as Error).message)
  }
}

async function handleJoin(msg: Message, args: string[], guildIn: Guild | undefined, voiceIn: VoiceChannel | null, queue: Queue | undefined): Promise<void> {
  let voiceChannel: VoiceChannel | undefined
  let guild = guildIn

  if (voiceIn) {
    voiceChannel = voiceIn
    if (!guild) guild = voiceIn.guild
  } else {
    const voiceChannelId = args[0]
    if (!voiceChannelId) {
      msg.reply("❌ Kamu tidak terdeteksi di voice channel manapun. Gunakan ?join <voice_channel_id>")
      return
    }

    if (guild) {
      voiceChannel = guild.channels.cache.get(voiceChannelId) as VoiceChannel | undefined
      if (!voiceChannel) {
        try {
          const fetched = await guild.channels.fetch(voiceChannelId)
          voiceChannel = fetched as VoiceChannel
        } catch {}
      }
    } else {
      for (const [, g] of msg.client.guilds.cache) {
        const ch = g.channels.cache.get(voiceChannelId)
        if (ch && Number(ch.type) === 2) {
          voiceChannel = ch as VoiceChannel
          guild = g
          break
        }
        try {
          const fetched = await g.channels.fetch(voiceChannelId)
          if (fetched && Number(fetched.type) === 2) {
            voiceChannel = fetched as VoiceChannel
            guild = g
            break
          }
        } catch {}
      }
    }
  }

  if (!voiceChannel || Number(voiceChannel.type) !== 2) {
    msg.reply("❌ Voice channel tidak ditemukan atau ID tidak valid")
    return
  }

  if (msg.member && guild) {
    try {
      const member = await guild.members.fetch(msg.author.id)
      if (!member.permissionsIn(voiceChannel.id).has("CONNECT" as any)) {
        msg.reply("❌ Kamu tidak memiliki izin untuk join ke voice channel tersebut")
        return
      }
    } catch {
      msg.reply("❌ Kamu tidak memiliki izin untuk join ke voice channel tersebut")
      return
    }
  }

  try {
    if (queue && queue.connection) queue.connection.destroy()

    if (!guild) {
      msg.reply("❌ Guild tidak ditemukan")
      return
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false
    })

    const player = createAudioPlayer()
    connection.subscribe(player)

    const playbackChannel = (msg.channel as any).guild
      ? msg.channel
      : (voiceChannel.guild.systemChannel || voiceChannel.guild.channels.cache.find(c => {
          const ch = c as any
          return ch.isTextBased && ch.type === 0
        }) || voiceChannel.guild.channels.cache.first())

    if (!queue) {
      queue = createDefaultQueue({
        textChannel: playbackChannel as any,
        connection,
        player,
        voiceChannelId: voiceChannel.id
      })
      queues.set(guild.id, queue!)
    } else {
      queue.connection = connection
      queue.voiceChannelId = voiceChannel.id
      queue.textChannel = playbackChannel as any
      connection.subscribe(queue.player)
    }

    saveState()
    msg.channel.send(`✅ Bot berhasil join ke voice channel: **${voiceChannel.name}**`)

  } catch (err) {
    console.error("Error joining voice channel:", err)
    msg.reply("❌ Gagal join ke voice channel: " + (err as Error).message)
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
    msg.reply("❌ Bot belum join ke voice channel. Gunakan command ?play atau ?radio terlebih dahulu.")
    return
  }
  createCommandPanel(msg, queue)
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
  handlePanel
}
