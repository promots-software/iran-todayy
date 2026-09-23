import { Api, type TelegramClient } from "teleproto";
import { z } from "zod";
import { ProcessingError, type Incoming, type Monitor } from "../processing/contracts";
import { assertShadowMode } from "../processing/shadow";

export const cursorSchema = z.object({ kind: z.literal("telegram-shadow-v1"), channelId: z.string().regex(/^\d+$/), lastId: z.number().int().nonnegative(), baselineId:z.number().int().nonnegative().optional(), initializedAt:z.string().datetime().optional(), baselinePending:z.boolean().optional() }).strict();
/** Preserve the old checkpoint until the next read atomically establishes a new activation boundary. */
export function activationCursor(cursor:unknown) {
  if(cursor==null)return null;
  const parsed=cursorSchema.safeParse(cursor);
  if(!parsed.success)throw new ProcessingError('TELEGRAM_CURSOR_INVALID');
  return {...parsed.data,baselinePending:true};
}
export type TelegramCursor = z.infer<typeof cursorSchema>;
export type ReadMessage = { id: number; text: string; date: number; hasMedia?:boolean; hasPhoto?:boolean; service?:boolean };
/** RPC page size, not a stories-per-minute or collection limit. */
export const telegramPageSize=50;
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
    const result = await abortable(() => this.client.getMessages(handle,
      after===null?{limit:1}:{ limit: telegramPageSize, minId: after, reverse: true }), signal);
    return result.map(m => ({ id: m.id, text: m.message ?? "", date: m.date, hasMedia:!!m.media, hasPhoto:m.media instanceof Api.MessageMediaPhoto, service:m instanceof Api.MessageService }));
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
      if(!previous||previous.baselinePending){
        const latest=await this.reader.messages(input.handle,null,signal);
        signal.throwIfAborted();
        if(latest.some(m=>!Number.isSafeInteger(m.id)||m.id<=0))throw new ProcessingError('TELEGRAM_MESSAGE_INVALID');
        const lastId=Math.max(previous?.lastId??0,...latest.map(m=>m.id));
        return {posts:[],hasMore:false,cursor:{kind:'telegram-shadow-v1',channelId,lastId,baselineId:lastId,initializedAt:new Date(this.now()).toISOString()} satisfies TelegramCursor};
      }
      const messages = await this.reader.messages(input.handle, previous.lastId, signal);
      signal.throwIfAborted();
      const posts: Incoming[] = [];
      let lastId = previous?.lastId ?? 0;
      for (const message of messages.sort((a, b) => a.id - b.id)) {
        if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new ProcessingError("TELEGRAM_MESSAGE_INVALID");
        if (previous && message.id <= previous.lastId) continue;
        lastId = Math.max(lastId, message.id);
        posts.push({ externalId: String(message.id), url: `https://t.me/${input.handle}/${message.id}`,
          content: message.text, publishedAt: new Date(message.date * 1000),
          metadata: { transport: this.id, channelId, shadowMode: true, hasMedia:message.hasMedia===true, hasPhoto:message.hasPhoto===true,
            messageKind:message.service?'SERVICE':message.text.trim()?'TEXT':message.hasMedia?'MEDIA_ONLY':'EMPTY' } });
      }
      if(messages.length&&lastId<=(previous?.lastId??0))throw new ProcessingError('TELEGRAM_CURSOR_STALLED',true);
      // Even a short page may be followed by more available IDs. Probe again
      // only AFTER this page's posts/jobs and checkpoint have been persisted.
      return { posts, hasMore:messages.length>0, cursor: { ...previous, kind: "telegram-shadow-v1", channelId, lastId } satisfies TelegramCursor };
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
