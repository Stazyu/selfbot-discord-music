async function removeAllReactionsFromChannel(channel) {
    try {
        let lastId = null
        let hasMore = true
        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000

        while (hasMore) {
            const options = { limit: 100 }
            if (lastId) {
                options.before = lastId
            }

            const messages = await channel.messages.fetch(options)

            if (messages.size === 0) {
                hasMore = false
                break
            }

            for (const [id, msg] of messages) {
                // Only remove reactions from messages created by the bot and not older than 14 days
                if (msg.reactions.cache.size > 0 &&
                    msg.author.bot &&
                    msg.createdTimestamp > twoWeeksAgo) {
                    try {
                        await msg.reactions.removeAll()
                        console.log("Removed reactions from message:", id)
                    } catch (err) {
                        // Silently ignore permission errors for messages we can't modify
                        if (err.code === 50013) {
                            console.log("Skipping message due to permissions:", id)
                        } else {
                            console.error("Error removing reactions from message:", id, err)
                        }
                    }
                }
            }

            lastId = messages.last().id

            if (messages.size < 100) {
                hasMore = false
            }
        }
    } catch (err) {
        console.error("Error removing reactions from channel:", err)
    }
}

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

    // Remove all reactions from channel to avoid spam
    await removeAllReactionsFromChannel(message.channel)

    // Stop previous collector if exists
    if (queue.reactionCollector && typeof queue.reactionCollector.stop === "function") {
        queue.reactionCollector.stop()
        console.log("Stopped previous reaction collector")
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

// Import playSong function from index.js
let playSong

function setPlaySongFunction(fn) {
    playSong = fn
}

async function createCommandPanel(message, queue) {
    const controls = ["⏮", "⏯️", "⏭", "🔉", "🔊", "⏹", "📻", "🎵", "🗑️", "ℹ️"]

    console.log("Creating command panel for message:", message.id)

    // Remove all reactions from channel to avoid spam
    await removeAllReactionsFromChannel(message.channel)

    // Stop previous panel collector if exists
    if (queue.panelCollector && typeof queue.panelCollector.stop === "function") {
        queue.panelCollector.stop()
        console.log("Stopped previous panel collector")
    }

    const panelContent = `🎵 **Music Control Panel** 🎵

**Controls:**
⏮ - Previous song (if in queue)
⏯️ - Play/Pause
⏭ - Skip current song
🔉 - Volume Down
🔊 - Volume Up
⏹ - Stop & Clear Queue
📻 - Back to Radio
🎵 - Music Mode
🗑️ - Clear Chat
ℹ️ - Show Queue Info

**Available Commands:**
**?play** <song name> - Search and play a song
**?play** <single URL> - Play a single YouTube video
**?play** <playlist URL> [limit] - Play a YouTube playlist (optional limit)
**?play** <URL1 URL2 URL3...> - Play multiple URLs (space-separated)
**?skip** - Skip the current song
**?loop** - Toggle loop mode (Off/Single/All)
**?shuffle** - Shuffle the current queue
**?queue** - Show current queue and loop mode
**?stop** - Stop playing and clear queue
**?volume** [0-100] - Set or check playback volume
**?radio** <station name or URL> - Play a radio station
**?clearchat** [number] - Delete messages in text channel (default 100, max 100)
**?leave** - Leave voice channel and clear queue
**?sync** - Sync channel ID dan auto-join ke voice channel saat ini
**?state** - Show current bot state
**?panel** - Show control panel with reaction UI
**?help** - Show this help message`

    const panelMsg = await message.channel.send(panelContent)

    try {
        for (const emoji of controls) {
            await panelMsg.react(emoji)
        }
        console.log("Panel reactions added successfully")
    } catch (err) {
        console.error("Error adding panel reactions:", err)
    }

    const filter = (reaction, user) => {
        return controls.includes(reaction.emoji.name) && !user.bot
    }

    const collector = panelMsg.createReactionCollector({
        filter
    })

    collector.on("collect", async (reaction, user) => {
        switch (reaction.emoji.name) {
            case "⏮":
                // Previous song (if queue has more than 1 song)
                if (queue.songs.length > 1) {
                    queue.songs.unshift(queue.songs.pop())
                    if (queue.currentProcesses) {
                        queue.currentProcesses.ytdlp.kill()
                        queue.currentProcesses.ff.kill()
                    }
                    queue.player.stop()
                    queue.textChannel.send("⏮️ Playing previous song")
                } else {
                    queue.textChannel.send("ℹ️ No previous song in queue")
                }
                break

            case "⏯️":
                // Play/Pause
                if (queue.player.state.status === "paused") {
                    queue.player.unpause()
                    queue.textChannel.send("▶️ Resumed")
                } else {
                    queue.player.pause()
                    queue.textChannel.send("⏸️ Paused")
                }
                break

            case "⏭":
                // Skip
                if (queue.currentProcesses) {
                    queue.currentProcesses.ytdlp.kill()
                    queue.currentProcesses.ff.kill()
                }
                queue.player.stop()
                queue.textChannel.send("⏭️ Skipped")
                break

            case "🔉":
                // Volume down
                queue.volume = Math.max(0, (queue.volume ?? 1.0) - 0.2)
                if (queue.player.state.status === "playing" && queue.player.state.resource?.volume) {
                    queue.player.state.resource.volume.setVolume(queue.volume)
                }
                queue.textChannel.send(`🔉 Volume: **${Math.round(queue.volume * 100)}%**`)
                break

            case "🔊":
                // Volume up
                queue.volume = Math.min(5, (queue.volume ?? 1.0) + 0.2)
                if (queue.player.state.status === "playing" && queue.player.state.resource?.volume) {
                    queue.player.state.resource.volume.setVolume(queue.volume)
                }
                queue.textChannel.send(`🔊 Volume: **${Math.round(queue.volume * 100)}%**`)
                break

            case "⏹":
                // Stop & Clear
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
                queue.textChannel.send("⏹️ Stopped & Queue Cleared")
                break

            case "🎵":
                // Music Mode - switch from radio to music if queue has songs
                if (queue.songs.length > 0) {
                    if (queue.radioFfmpeg) {
                        queue.radioFfmpeg.kill()
                        queue.radioFfmpeg = null
                    }
                    queue.radioStopped = true
                    queue.textChannel.send("🎵 Switching to Music Mode")
                    playSong(queue.textChannel.guild, queue.songs[0])
                } else {
                    queue.textChannel.send("ℹ️ No songs in queue. Use ?play to add songs first")
                }
                break

            case "📻":
                // Back to Radio - switch from music to radio if radio URL exists
                if (queue.radioUrl && queue.radioName) {
                    if (queue.currentProcesses) {
                        queue.currentProcesses.ytdlp.kill()
                        queue.currentProcesses.ff.kill()
                    }
                    queue.radioStopped = false
                    queue.textChannel.send("📻 Switching back to Radio Mode")
                    // Use setTimeout to avoid circular dependency
                    setTimeout(() => {
                        const { playRadio } = require("./index.js")
                        playRadio(queue.textChannel.guild, queue.radioUrl, queue.radioName)
                    }, 100)
                } else {
                    queue.textChannel.send("ℹ️ No radio station available. Use ?radio to set a station first")
                }
                break

            case "🗑️":
                // Clear last 10 messages
                const messages = await queue.textChannel.messages.fetch({ limit: 11 })
                const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
                const messagesToDelete = messages.filter(m => m.createdTimestamp > twoWeeksAgo && m.id !== panelMsg.id)

                let deletedCount = 0
                for (const [id, msg] of messagesToDelete) {
                    try {
                        await msg.delete()
                        deletedCount++
                    } catch (err) {
                        console.error("Error deleting message:", err)
                    }
                }
                queue.textChannel.send(`🗑️ Deleted **${deletedCount}** messages`)
                break

            case "ℹ️":
                // Queue info
                let queueInfo = `📋 **Queue Info**\n\n`
                if (queue.currentSong) {
                    queueInfo += `🎵 Now Playing: **${queue.currentSong?.title || 'Unknown Song'}**\n`
                }
                queueInfo += `🔊 Volume: **${Math.round((queue.volume ?? 1.0) * 100)}%**\n`
                queueInfo += `📝 Songs in Queue: **${queue.songs.length}**\n`
                if (queue.songs.length > 0) {
                    queueInfo += `\n📜 **Queue List:**\n`
                    queue.songs.slice(0, 10).forEach((song, i) => {
                        if (song && song.title) {
                            queueInfo += `${i + 1}. ${song.title}\n`
                        }
                    })
                    if (queue.songs.length > 10) {
                        queueInfo += `... and ${queue.songs.length - 10} more\n`
                    }
                }
                if (queue.radioUrl && queue.radioName && !queue.radioStopped) {
                    queueInfo += `📻 Radio: **${queue.radioName}**\n`
                }
                if (queue.playHistory && queue.playHistory.length > 0) {
                    queueInfo += `\n🕐 **Recently Played:**\n`
                    queue.playHistory.slice(0, 5).forEach((song, i) => {
                        if (song && song.title) {
                            queueInfo += `${i + 1}. ${song.title}\n`
                        }
                    })
                }
                queue.textChannel.send(queueInfo)
                break
        }

        // Remove the reaction after handling
        reaction.users.remove(user.id).catch(console.error)
    })

    // Update queue with panel message and collector
    queue.panelMessage = panelMsg
    queue.panelCollector = collector

    return collector
}

module.exports = { createReactionUI, removeReactionUI, createCommandPanel, setPlaySongFunction }
