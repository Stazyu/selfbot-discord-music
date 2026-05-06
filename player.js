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
        loopMode: 0, // 0: Off, 1: Single, 2: All
        isSkipping: false,

        async play() {

            this.playing = true

            const song = this.songs[0]

            const audio = stream(song.url)

            const resource = createAudioResource(audio)

            this.player.play(resource)

            // createReactionUI(msg, queue)
            this.text.send(`🎶 Playing **${song.title}**`)


            this.player.once(AudioPlayerStatus.Idle, () => {

                if (this.isSkipping || this.loopMode === 0) {
                    this.songs.shift()
                    this.isSkipping = false
                } else if (this.loopMode === 2) {
                    const shiftedSong = this.songs.shift()
                    this.songs.push(shiftedSong)
                }
                // loopMode === 1: keep the current song at index 0

                if (this.songs.length)
                    this.play()
                else
                    this.stop()

            })
        },

        skip() {
            this.isSkipping = true
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
        },

        shuffle() {
            if (this.songs.length < 3) return; // Need at least 2 songs in queue (plus 1 playing)
            
            // Extract all songs except the first one (currently playing)
            const playing = this.songs.shift();
            
            // Fisher-Yates shuffle
            for (let i = this.songs.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.songs[i], this.songs[j]] = [this.songs[j], this.songs[i]];
            }
            
            // Put the playing song back to front
            this.songs.unshift(playing);
        }

    }

    return queue
}

module.exports = { createPlayer }