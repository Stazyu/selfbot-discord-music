const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus } = require("@discordjs/voice")
const { stream } = require("./yt")
const { createReactionUI } = require("./reactionUI")

function createPlayer(msg, voice) {

    const connection = joinVoiceChannel({
        channelId: voice.id,
        guildId: msg.guild.id,
        adapterCreator: msg.guild.voiceAdapterCreator
    })

    const player = createAudioPlayer()

    connection.subscribe(player)

    const queue = {

        text: msg.channel,
        connection,
        player,
        songs: [],
        playing: false,

        async play() {

            this.playing = true

            const song = this.songs[0]

            const audio = stream(song.url)

            const resource = createAudioResource(audio)

            this.player.play(resource)

            // createReactionUI(msg, queue)
            this.text.send(`🎶 Playing **${song.title}**`)


            this.player.once(AudioPlayerStatus.Idle, () => {

                this.songs.shift()

                if (this.songs.length)
                    this.play()
                else
                    this.stop()

            })
        },

        skip() {
            this.player.stop()
        },

        pause() {
            this.player.pause()
        },

        resume() {
            this.player.unpause()
        },

        stop() {

            this.songs = []

            this.connection.destroy()

            this.playing = false
        }

    }

    return queue
}

module.exports = { createPlayer }