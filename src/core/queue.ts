import fs from "fs"
import config from "../config"
import { Queue, Song } from "../types"

const queues: Map<string, Queue> = new Map()

function saveState(stateLog: boolean = true): void {
  const state: Record<string, unknown> = {}
  for (const [guildId, queue] of queues) {
    let songs: Song[] = queue.songs

    if (queue.playing && queue.currentSong && !queue.currentSong.isRadio && queue.songs.length > 0) {
      const startedAt = new Date(queue.currentSong.startedAt)
      const elapsedSeconds = Math.floor((Date.now() - startedAt.getTime()) / 1000)
      songs = queue.songs.map((s, i) => {
        if (i === 0) return { ...s, resumeFrom: elapsedSeconds }
        return s
      })
    }

    state[guildId] = {
      voiceChannelId: queue.voiceChannelId,
      volume: queue.volume ?? 0.3,
      songs: songs,
      radioUrl: queue.radioUrl,
      radioName: queue.radioName,
      radioStopped: queue.radioStopped,
      playHistory: queue.playHistory || [],
      loopMode: queue.loopMode || 0,
      playing: queue.playing || false,
      musicReconnectAttempts: queue.musicReconnectAttempts || 0,
      isMusicReconnecting: queue.isMusicReconnecting || false
    }
  }

  try {
    fs.writeFileSync(config.stateFile, JSON.stringify(state, null, 2))
    if (stateLog) {
      console.log(" State saved to", config.stateFile)
    }
  } catch (err) {
    console.error("Error saving state:", err)
  }
}

function loadState(): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(config.stateFile)) {
      console.log("No state file found, creating new one...")
      console.log(`State file location: ${config.stateFile}`)
      fs.writeFileSync(config.stateFile, JSON.stringify({}, null, 2))
      return {}
    }
    const data = fs.readFileSync(config.stateFile, "utf8")
    const state = JSON.parse(data)
    console.log("State loaded from", config.stateFile)
    console.log(`State contains ${Object.keys(state).length} guild(s)`)
    return state
  } catch (err) {
    console.error("Error loading state:", err)
    console.log(`Attempted to load from: ${config.stateFile}`)
    return null
  }
}

function createDefaultQueue(overrides: Partial<Queue> = {}): Queue {
  return {
    songs: [],
    voiceChannelId: null,
    volume: 0.3,
    playHistory: [],
    loopMode: 0,
    isSkipping: false,
    playing: false,
    radioUrl: null,
    radioName: null,
    radioStopped: true,
    radioFfmpeg: null,
    musicReconnectAttempts: 0,
    musicReconnectMessage: null,
    isMusicReconnecting: false,
    connection: null,
    reactionCollector: null,
    panelCollector: null,
    reconnectMessage: null,
    ...overrides
  } as Queue
}

export { queues, saveState, loadState, createDefaultQueue }
