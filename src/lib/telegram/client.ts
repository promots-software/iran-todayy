import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { Logger, LogLevel } from "teleproto/extensions/Logger";
import { ProcessingError } from "../processing/contracts";
import { assertShadowMode } from "../processing/shadow";

export function createTelegramClient(authorize = false) {
  assertShadowMode();
  const id = process.env.TELEGRAM_API_ID ?? "";
  const hash = process.env.TELEGRAM_API_HASH ?? "";
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0 || !/^[a-f\d]{32}$/i.test(hash)) {
    throw new ProcessingError("TELEGRAM_CREDENTIALS_REQUIRED");
  }
  const session = process.env.TELEGRAM_SESSION ?? "";
  if (!authorize && !session) throw new ProcessingError("TELEGRAM_AUTHORIZATION_REQUIRED");
  let savedSession: StringSession;
  try { savedSession = new StringSession(session); }
  catch { throw new ProcessingError("TELEGRAM_SESSION_INVALID"); }
  return new TelegramClient(savedSession, Number(id), hash, {
    baseLogger: new Logger(LogLevel.NONE), connectionRetries: 3, requestRetries: 2,
    reconnectRetries: 3, autoReconnect: true, timeout: 10,
    floodSleepThreshold: 0, deviceModel: "Iran Today shadow reader",
    appVersion: "0.3A",
  });
}
