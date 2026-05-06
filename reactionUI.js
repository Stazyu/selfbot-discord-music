async function removeReactionUI(message, collector) {
    if (!message) return

    try {
        await message.reactions.removeAll()
        console.log("Removed reactions from message:", message.id)
    } catch (err) {
        console.error("Error removing reactions:", err)
    }

    if (collector && typeof collector.stop === "function") {
        collector.stop()
        console.log("Stopped reaction collector")
    }
}

async function createReactionUI(message, queue) {

    const controls = ["⏯", "⏭", "🔉", "🔊", "⏹"]

    console.log("Creating reaction UI for message:", message.id)

    // Remove reaction UI from previous message if exists
    if (queue.reactionMessage && queue.reactionCollector) {
        await removeReactionUI(queue.reactionMessage, queue.reactionCollector)
    }

    try {
        for (const emoji of controls) {
            await message.react(emoji)
        }
        console.log("Reactions added successfully")
    } catch (err) {
        console.error("Error adding reactions:", err)
    }

    const filter = (reaction, user) => {
        return controls.includes(reaction.emoji.name) && !user.bot
    }

    const collector = message.createReactionCollector({
        filter
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
                queue.isReconnecting = false
                queue.player.stop()
                collector.stop()

                break
        }

    })

    // Update queue with new reaction message and collector
    queue.reactionMessage = message
    queue.reactionCollector = collector

    return collector
}

module.exports = { createReactionUI, removeReactionUI }
