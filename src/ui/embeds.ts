interface NowPlayingSong {
  title?: string
  duration?: string
}

function progressBar(percent: number): string {
  const size = 20
  const progress = Math.round(size * percent)
  return "▬".repeat(progress) + "🔘" + "▬".repeat(size - progress)
}

function buildNowPlaying(song?: NowPlayingSong): string {
  return `
🎶 **Now Playing**

${song?.title || 'Unknown Song'}

${progressBar(0.3)}

00:30 / ${song?.duration || 'Unknown'}

Controls
⏯ pause
⏭ skip
⏹ stop
`
}

export { buildNowPlaying }
