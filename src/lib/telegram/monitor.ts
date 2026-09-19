import { Api, type TelegramClient } from "teleproto";
import { z } from "zod";
import { ProcessingError, type Incoming, type Monitor } from "../processing/contracts";
import { assertShadowMode } from "../processing/shadow";

const cursorSchema = z.object({ kind: z.literal("telegram-shadow-v1"), channelId: z.string().regex(/^\d+$/), lastId: z.number().int().nonnegative() }).strict();
export type TelegramCursor = z.infer<typeof cursorSchema>;
export type ReadMessage = { id: number; text: string; date: number; hasMedia?:boolean; hasPhoto?:boolean };
export interface ChannelReader {
  /** The signal is part of the reader contract so a timed-out RPC cannot
   * leave the poll promise pending while the worker is trying to reconnect. */
  channel(handle: string, signal?: AbortSignal): Promise<string>;
  messages(handle: string, after: number | null, signal?: AbortSignal): Promise<ReadMessage[]>;
}

/**
 * teleproto's high-level helpers do not accept AbortSignal. Race the request
 * with the worker signal so the polling operation settles promptly when the
 * worker's timeout/reconnect path fires. The underlying read is harmless and
 * read-only; reconnect destroys the old client before a new one is used.
 */
function abortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new ProcessingError("TELEGRAM_OPERATION_ABORTED", true));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve().then(() => { signal.throwIfAborted(); return operation(); })
      .then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Only resolves public broadcast channels and reads history. No joins, sends or read acknowledgements. */
export class TelegramReader implements ChannelReader {
  constructor(private client: TelegramClient) {}
  async channel(handle: string, signal = new AbortController().signal) {
    const entity = await abortable(() => this.client.getEntity(handle), signal);
    if (!(entity instanceof Api.Channel) || !entity.broadcast || entity.username?.toLowerCase() !== handle.toLowerCase()) {
      throw new ProcessingError("TELEGRAM_PUBLIC_CHANNEL_REQUIRED");
    }
    return entity.id.toString();
  }
  async messages(handle: string, after: number | null, signal = new AbortController().signal) {
    const result = await abortable(() => this.client.getMessages(handle, after === null
      ? { limit: 1 } : { limit: 50, minId: after, reverse: true }), signal);
    return result.map(m => ({ id: m.id, text: m.message ?? "", date: m.date, hasMedia:!!m.media, hasPhoto:m.media instanceof Api.MessageMediaPhoto }));
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
      const channelId = await this.reader.channel(input.handle, signal);
      if (previous && previous.channelId !== channelId) throw new ProcessingError("TELEGRAM_CHANNEL_CHANGED");
      const messages = await this.reader.messages(input.handle, previous?.lastId ?? null, signal);
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
          metadata: { transport: this.id, channelId, shadowMode: true, hasMedia:message.hasMedia===true, hasPhoto:message.hasPhoto===true } });
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
