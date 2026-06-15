import dotenv from "dotenv"
import path from "path"
import { Config } from "./types"

dotenv.config()

const config: Config = {
  prefix: process.env.DISCORD_PREFIX || "?",
  token: process.env.DISCORD_TOKEN || "",
  allowedUsers: process.env.ALLOWED_USERS ? process.env.ALLOWED_USERS.split(",") : [],
  ytdlpExecutable: process.platform === "win32" ? "./yt-dlp.exe" : "yt-dlp",
  ffmpeg: process.platform === "win32" ? require("ffmpeg-static") : "ffmpeg",
  stateFile: process.env.STATE_FILE || path.join(__dirname, "..", "state.json"),
  cookiesFile: process.env.COOKIES_FILE || path.join(__dirname, "..", "cookies.txt")
}

if (!config.token) {
  try {
    const fileConfig: { prefix?: string; token: string; allowedUsers?: string[] } = require("../config.json")
    config.prefix = fileConfig.prefix || config.prefix
    config.token = fileConfig.token
    config.allowedUsers = fileConfig.allowedUsers || config.allowedUsers
  } catch {
    console.error("Error: DISCORD_TOKEN environment variable or config.json required")
    process.exit(1)
  }
}

export default config
