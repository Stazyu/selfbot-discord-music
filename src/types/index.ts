import { ChildProcess } from "child_process"
import { AudioPlayer, VoiceConnection } from "@discordjs/voice"
import { Message, TextChannel, MessageReaction, ReactionCollector, Guild, VoiceChannel } from "selfbotsdk-discordjs"

export interface SongData {
  title: string
  url: string
  duration?: number
  durationFormatted?: string
  resumeFrom?: number
}

export interface Song extends SongData {
  isRadio?: boolean
}

export interface PlayHistoryItem {
  title: string
  url: string
  playedAt: string
  isRadio: boolean
}

export interface CurrentSong {
  title: string
  url: string
  startedAt: string
  isRadio: boolean
}

export interface Processes {
  ytdlp: ChildProcess
  ff: ChildProcess
}

export interface StreamStats {
  sizeMB: string
  lastRestart: string
}

export interface RadioMetadataDetectorStatus {
  currentSong: string | null
  lastSuccessfulDetection: number
  consecutiveErrors: number
}

export interface RadioMetadataDetector {
  stop: () => void
  getStatus: () => RadioMetadataDetectorStatus
}

export interface FFmpegWithExtensions extends ChildProcess {
  _brokenPipeDetected?: boolean
  getStreamStats?: () => StreamStats
}

export interface Queue {
  songs: Song[]
  voiceChannelId: string | null
  volume: number
  playHistory: PlayHistoryItem[]
  loopMode: number
  isSkipping: boolean
  playing: boolean
  radioUrl: string | null
  radioName: string | null
  radioStopped: boolean
  radioFfmpeg: FFmpegWithExtensions | null
  musicReconnectAttempts: number
  musicReconnectMessage: Message | null
  isMusicReconnecting: boolean
  textChannel?: TextChannel
  connection: VoiceConnection | null
  player: AudioPlayer
  currentSong?: CurrentSong
  currentProcesses?: Processes
  reactionMessage?: Message
  reactionCollector: ReactionCollector | null
  panelMessage?: Message
  panelCollector: ReactionCollector | null
  _saveInterval?: NodeJS.Timeout
  radioMessage?: Message
  reconnectMessage: Message | null
  isReconnecting?: boolean
  radioReconnectAttempts?: number
  metadataDetector?: RadioMetadataDetector
  hasReactionUI?: boolean
}

export interface RadioMetadataResult {
  url: string
  name: string
  country?: string | null
  codec?: string | null
}

export interface Config {
  prefix: string
  token: string
  allowedUsers: string[]
  ytdlpExecutable: string
  ffmpeg: string
  stateFile: string
  cookiesFile: string
}

export interface PlaylistVideoEntry {
  title: string
  url: string
  duration: number
  durationFormatted: string | undefined
}

export interface YouTubeSearchResult {
  title: string
  url: string
  duration: number
  durationFormatted: string
}
