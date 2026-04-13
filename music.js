const { Client } = require("discord.js-selfbot-v13")
const { createPlayer } = require("./player")
const { searchSong } = require("./yt")
const { buildNowPlaying } = require("./ui")
const { createReactionUI } = require("./reactionUI")
const config = require("./config.json")

const client = new Client()

const PREFIX = config.prefix
const TOKEN = config.token

const queues = new Map()

client.on("ready", () => {
    console.log("🎵 Music Selfbot Ready:", client.user.tag)
})

client.on("messageCreate", async msg => {

    if (!msg.content.startsWith(PREFIX)) return

    const args = msg.content.slice(PREFIX.length).split(/ +/)
    const cmd = args.shift().toLowerCase()
    const query = args.join(" ")

    const voice = msg.member.voice.channel
    if (!voice) return msg.reply("Join VC dulu")

    let queue = queues.get(msg.guild.id)

    if (cmd === "play") {

        const song = await searchSong(query)

        if (!queue) {

            queue = createPlayer(msg, voice)

            queues.set(msg.guild.id, queue)
        }

        queue.songs.push(song)

        msg.channel.send(`📥 Added **${song.title}**`)
        // msg.channel.send(buildNowPlaying(queue.songs[0]))

        if (!queue.playing)
            queue.play()
    }

    if (cmd === "skip") {
        queue?.skip()
    }

    if (cmd === "pause") {
        queue?.pause()
    }

    if (cmd === "resume") {
        queue?.resume()
    }

    if (cmd === "stop") {
        queue?.stop()
    }

    if (cmd === "queue") {

        if (!queue || !queue.songs.length)
            return msg.channel.send("Queue kosong")

        const list = queue.songs
            .map((s, i) => `${i + 1}. ${s.title}`)
            .join("\n")

        msg.channel.send(`📜 Queue\n${list}`)
    }

    if (cmd === "np") {

        if (!queue || !queue.songs[0]) return

        const msg = await channel.send(nowPlayingText)

        createReactionUI(msg, queue)

        // msg.channel.send(buildNowPlaying(queue.songs[0]))
    }

})

client.login(TOKEN)
