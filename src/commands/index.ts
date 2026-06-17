import { Message, Guild, VoiceChannel } from "selfbotsdk-discordjs"
import config from "../config"
import { queues } from "../core/queue"
import { handlePlay, handleSkip, handleLoop, handleShuffle, handleQueue, handleStop, handleVolume } from "./music"
import { handleRadio, handleRadioStats } from "./radio"
import { handleTest, handleHelp, handleLeave, handleClearChat, handleClearReactions, handleSync, handleJoin, handleState, handlePanel } from "./utility"
import { Queue } from "../types"

async function handleMessageCreate(msg: Message): Promise<void> {
  if (!msg.content.startsWith(config.prefix)) return

  if (config.allowedUsers.length > 0 && !config.allowedUsers.includes(msg.author.id)) {
    return
  }

  const args = msg.content.slice(config.prefix.length).trim().split(/ +/)
  const cmd = args.shift()?.toLowerCase() || ""

  const channelName = (msg.channel as any).name || "DM"
  console.log(`\x1b[36m[COMMAND]\x1b[0m \x1b[33m${cmd}\x1b[0m | \x1b[35mUser:\x1b[0m ${msg.author.tag} (${msg.author.id}) | \x1b[34mChannel:\x1b[0m ${channelName} (${msg.channel.id}) | \x1b[32mQuery:\x1b[0m ${args.join(" ") || "N/A"}`)

  let guild: Guild | undefined = msg.guild || undefined
  let voice: VoiceChannel | null = null
  let queue: Queue | undefined

  if (!msg.member) {
    for (const [, g] of msg.client.guilds.cache) {
      try {
        const member = await g.members.fetch(msg.author.id)
        if (member.voice.channel) {
          guild = g
          voice = member.voice.channel as VoiceChannel
          queue = queues.get(guild.id)
          console.log(`[DM] Found user in voice channel: ${voice.name} in guild ${g.name}`)
          break
        }
      } catch {
        continue
      }
    }

    if (!voice) {
      msg.reply("❌ Kamu harus berada di voice channel di salah satu server untuk menggunakan command ini di DM")
      return
    }
  } else {
    voice = msg.member.voice.channel as VoiceChannel | null
    if (!voice && cmd !== "help" && cmd !== "state" && cmd !== "test") {
      msg.reply("Join VC dulu")
      return
    }
    if (guild) queue = queues.get(guild.id)
  }

  switch (cmd) {
    case "test": {
      handleTest(msg)
      return
    }
    case "play": {
      if (!guild) { msg.reply("Guild not found"); return }
      await handlePlay(msg, args, guild, voice, queue)
      return
    }
    case "skip": {
      handleSkip(msg, queue)
      return
    }
    case "loop": {
      handleLoop(msg, queue)
      return
    }
    case "shuffle": {
      handleShuffle(msg, queue)
      return
    }
    case "queue": {
      handleQueue(msg, queue)
      return
    }
    case "stop": {
      handleStop(msg, queue)
      return
    }
    case "volume":
    case "vol": {
      handleVolume(msg, args, queue)
      return
    }
    case "radio": {
      if (!guild) { msg.reply("Guild not found"); return }
      await handleRadio(msg, args, guild, voice, queue)
      return
    }
    case "radiostats": {
      handleRadioStats(msg, queue)
      return
    }
    case "leave": {
      handleLeave(msg, guild, queue)
      return
    }
    case "clearchat": {
      await handleClearChat(msg, args, queue)
      return
    }
    case "clearreactions": {
      await handleClearReactions(msg, queue)
      return
    }
    case "sync": {
      if (!guild) { msg.reply("Guild not found"); return }
      await handleSync(msg, args, guild, voice, queue)
      return
    }
    case "join": {
      if (!guild) { msg.reply("Guild not found"); return }
      await handleJoin(msg, args, guild, voice, queue)
      return
    }
    case "help": {
      handleHelp(msg)
      return
    }
    case "panel": {
      handlePanel(msg, queue)
      return
    }
    case "state": {
      handleState(msg)
      return
    }
  }
}

export { handleMessageCreate }
