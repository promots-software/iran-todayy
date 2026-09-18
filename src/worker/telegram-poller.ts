import {ProcessingError, type Monitor} from '../lib/processing/contracts';
import {TelegramMonitor, type ChannelReader} from '../lib/telegram/monitor';
import {deadline, drainedDeadline, safeWorkerError} from './runtime';

export interface PollConnection extends ChannelReader {
  readonly connected: boolean | undefined;
  connect(): Promise<void>;
  authorize(): Promise<void>;
  close(): Promise<void>;
}
type Options = {
  readMs?: number;
  connectMs?: number;
  drainMs?: number;
  requireActive?: () => void;
  log?: (event:string, fields:Record<string,unknown>) => void;
};

/** One transport owner. Only network work has a Telegram deadline; committing
 * a fetched page to Neon must never be cancelled as a Telegram timeout. */
export class TelegramPoller implements Monitor {
  readonly id = 'telegram-shadow-v1';
  readonly live = true;
  private connection?: PollConnection;
  private authorized = false;
  private monitor: TelegramMonitor;
  constructor(private factory: () => PollConnection, private options: Options = {}) {
    // Preserve the monitor's flood-wait cooldown across transport replacements.
    this.monitor = new TelegramMonitor({
      channel: (handle, signal) => this.connection!.channel(handle, signal),
      messages: (handle, after, signal) => this.connection!.messages(handle, after, signal),
    });
  }
  get ready() { return this.authorized && !!this.connection?.connected; }
  async close() {
    this.authorized = false;
    if (!this.connection) return;
    // Never start a replacement if destruction cannot finish. The supervisor
    // terminates the process on DRAIN_FAILED before releasing its lease.
    try { await deadline(this.connection.close(), new AbortController().signal, this.options.drainMs ?? 10000); }
    catch { throw new ProcessingError('WORKER_DRAIN_FAILED'); }
    this.connection = undefined;
    this.options.log?.('TELEGRAM_DISCONNECTED', {});
  }
  async poll(input: Parameters<Monitor['poll']>[0], signal: AbortSignal) {
    signal.throwIfAborted();
    this.options.requireActive?.();
    if (!this.ready) {
      await this.close();
      this.connection = this.factory();
      await drainedDeadline(async activeSignal => {
        await this.connection!.connect();
        activeSignal.throwIfAborted();
        await this.connection!.authorize();
        activeSignal.throwIfAborted();
      }, () => this.close(), signal, this.options.connectMs ?? 30000, this.options.drainMs ?? 10000);
      this.authorized = true;
      this.options.log?.('TELEGRAM_CONNECTED', {});
    }
    try {
      return await drainedDeadline(readSignal => this.monitor.poll(input, readSignal),
        () => this.close(), signal, this.options.readMs ?? 15000, this.options.drainMs ?? 10000);
    } catch (error) {
      // drainedDeadline closes and drains before the next source can reconnect.
      if (signal.aborted) throw error;
      const code = safeWorkerError(error) === 'WORKER_OPERATION_TIMEOUT' ? 'TELEGRAM_OPERATION_TIMEOUT' : safeWorkerError(error);
      this.options.log?.('TELEGRAM_READ_ERROR', {handle:input.handle, code});
      if (code === 'TELEGRAM_OPERATION_TIMEOUT') throw new ProcessingError(code, true);
      throw error;
    }
  }
}
