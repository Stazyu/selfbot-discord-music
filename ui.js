function progressBar(percent) {

    const size = 20
    const progress = Math.round(size * percent)

    return "▬".repeat(progress) + "🔘" + "▬".repeat(size - progress)
}

function buildNowPlaying(song) {

    return `
🎶 **Now Playing**

${song.title}

${progressBar(0.3)}

00:30 / ${song.duration}

Controls
⏯ pause
⏭ skip
⏹ stop
`
}

module.exports = { buildNowPlaying }
