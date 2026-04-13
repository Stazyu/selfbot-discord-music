async function createReactionUI(message, queue) {

    const controls = ["⏯", "⏭", "🔁", "⏹"]

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

                queue.player.stop()

                break

            case "🔁":

                queue.loop = !queue.loop
                message.channel.send(`Loop: ${queue.loop}`)

                break

            case "⏹":

                queue.stop()

                break
        }

    })
}

module.exports = { createReactionUI }
