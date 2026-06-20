import { Message } from "selfbotsdk-discordjs"
import { Queue } from "../types"

async function sendMsg(msg: Message, queue: Queue | undefined | null, content: string): Promise<void> {
  if (queue?.silent) {
    try {
      await msg.author.send(content)
    } catch {
      // If DM fails (e.g. selfbot can't DM itself), fallback to channel
      await msg.channel.send(content).catch(() => {})
    }
  } else {
    await msg.channel.send(content)
  }
}

async function sendToTextChannel(queue: Queue | undefined | null, content: string): Promise<any> {
  if (!queue?.textChannel) return

  if (queue.silent && queue.userId) {
    try {
      const user = await queue.textChannel.client.users.fetch(queue.userId)
      const dm = await user.createDM()
      return await dm.send(content)
    } catch {}
    return
  }

  return await queue.textChannel.send(content)
}

export { sendMsg, sendToTextChannel }
