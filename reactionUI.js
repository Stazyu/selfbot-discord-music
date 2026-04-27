async function createReactionUI(message, queue) {

    const controls = ["⏯", "⏭", "🔉", "🔊", "⏹"]

    for (const emoji of controls)
        await message.react(emoji)

    const filter = (reaction, user) => {
        return controls.includes(reaction.emoji.name) && !user.bot
    }

    const collector = message.createReactionCollector({
        filter,
        time: 1000 * 60 * 60
    })

    collector.on("collect", (reaction, user) => {

        switch (reaction.emoji.name) {

            case "⏯":

                if (queue.player.state.status === "paused")
                    queue.player.unpause()
                else
                    queue.player.pause()

                break

            case "⏭":

                if (queue.currentProcesses) {
                    queue.currentProcesses.ytdlp.kill()
                    queue.currentProcesses.ff.kill()
                }
                queue.player.stop()

                break

            case "🔉":

                queue.volume = Math.max(0, (queue.volume ?? 1.0) - 0.1)
                if (queue.player.state.status === "playing" && queue.player.state.resource?.volume) {
                    queue.player.state.resource.volume.setVolume(queue.volume)
                }
                message.channel.send(`🔉 Volume: **${Math.round(queue.volume * 100)}%**`)

                break

            case "🔊":

                queue.volume = Math.min(5, (queue.volume ?? 1.0) + 0.1)
                if (queue.player.state.status === "playing" && queue.player.state.resource?.volume) {
                    queue.player.state.resource.volume.setVolume(queue.volume)
                }
                message.channel.send(`🔊 Volume: **${Math.round(queue.volume * 100)}%**`)

                break

            case "⏹":

                if (queue.currentProcesses) {
                    queue.currentProcesses.ytdlp.kill()
                    queue.currentProcesses.ff.kill()
                }
                if (queue.radioFfmpeg) {
                    queue.radioFfmpeg.kill()
                }
                queue.songs = []
                queue.radioStopped = true
                queue.player.stop()

                break
        }

    })
}

module.exports = { createReactionUI }
