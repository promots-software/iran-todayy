import { Api, type TelegramClient } from "teleproto";
import { z } from "zod";
import { ProcessingError, type Incoming, type Monitor } from "../processing/contracts";
import { assertShadowMode } from "../processing/shadow";

const cursorSchema = z.object({ kind: z.literal("telegram-shadow-v1"), channelId: z.string().regex(/^\d+$/), lastId: z.number().int().nonnegative() }).strict();
export type TelegramCursor = z.infer<typeof cursorSchema>;
export type ReadMessage = { id: number; text: string; date: number };
export interface ChannelReader {
  channel(handle: string): Promise<string>;
  messages(handle: string, after: number | null): Promise<ReadMessage[]>;
}

/** Only resolves public broadcast channels and reads history. No joins, sends or read acknowledgements. */
export class TelegramReader implements ChannelReader {
  constructor(private client: TelegramClient) {}
  async channel(handle: string) {
    const entity = await this.client.getEntity(handle);
    if (!(entity instanceof Api.Channel) || !entity.broadcast || entity.username?.toLowerCase() !== handle.toLowerCase()) {
      throw new ProcessingError("TELEGRAM_PUBLIC_CHANNEL_REQUIRED");
    }
    return entity.id.toString();
  }
  async messages(handle: string, after: number | null) {
    const result = await this.client.getMessages(handle, after === null
      ? { limit: 1 } : { limit: 50, minId: after, reverse: true });
    return result.map(m => ({ id: m.id, text: m.message ?? "", date: m.date }));
  }
}

export class TelegramMonitor implements Monitor {
  readonly id = "telegram-shadow-v1";
  readonly live = true;
  private resumeAt = 0;
  constructor(private reader: ChannelReader, private now = () => Date.now()) {}
  async poll(input: { handle: string; cursor: unknown }, signal: AbortSignal) {
    assertShadowMode();
    signal.throwIfAborted();
    if (this.now() < this.resumeAt) throw new ProcessingError("TELEGRAM_FLOOD_WAIT", true);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{3,31}$/.test(input.handle)) throw new ProcessingError("TELEGRAM_HANDLE_INVALID");
    const parsed = input.cursor == null ? null : cursorSchema.safeParse(input.cursor);
    if (parsed && !parsed.success) throw new ProcessingError("TELEGRAM_CURSOR_INVALID");
    const previous = parsed?.success ? parsed.data : null;
    try {
      const channelId = await this.reader.channel(input.handle);
      if (previous && previous.channelId !== channelId) throw new ProcessingError("TELEGRAM_CHANNEL_CHANGED");
      const messages = await this.reader.messages(input.handle, previous?.lastId ?? null);
      signal.throwIfAborted();
      const posts: Incoming[] = [];
      let lastId = previous?.lastId ?? 0;
      for (const message of messages.sort((a, b) => a.id - b.id)) {
        if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new ProcessingError("TELEGRAM_MESSAGE_INVALID");
        if (previous && message.id <= previous.lastId) continue;
        lastId = Math.max(lastId, message.id);
        // Initial poll establishes the live boundary. No historical backfill is performed.
        if (!previous || !message.text.trim()) continue;
        posts.push({ externalId: String(message.id), url: `https://t.me/${input.handle}/${message.id}`,
          content: message.text, publishedAt: new Date(message.date * 1000),
          metadata: { transport: this.id, channelId, shadowMode: true } });
      }
      return { posts, cursor: { kind: "telegram-shadow-v1", channelId, lastId } satisfies TelegramCursor };
    } catch (error) {
      const seconds = typeof error === "object" && error !== null && "seconds" in error ? Number(error.seconds) : 0;
      if (Number.isFinite(seconds) && seconds > 0) {
        this.resumeAt = this.now() + (seconds + 1) * 1000;
        throw new ProcessingError("TELEGRAM_FLOOD_WAIT", true);
      }
      if (error instanceof ProcessingError) throw error;
      const rpcCode = typeof error === "object" && error !== null && "errorMessage" in error ? error.errorMessage : null;
      if (rpcCode === "USERNAME_INVALID" || rpcCode === "USERNAME_NOT_OCCUPIED" ||
        (error instanceof Error && /^No user has .* as username$/.test(error.message))) {
        throw new ProcessingError("TELEGRAM_USERNAME_UNAVAILABLE");
      }
      throw new ProcessingError("TELEGRAM_READ_FAILED", true);
    }
  }
}
