import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createTelegramClient } from "../src/lib/telegram/client";

// Never echo sensitive input, include it in argv, or print library errors/session strings.
function secretPrompt(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("LOCAL_TERMINAL_REQUIRED");
  process.stdout.write(`${label}: `);
  return new Promise((resolveInput, reject) => {
    let value = "";
    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") { finish(); reject(new Error("CANCELLED")); return; }
        if (char === "\r" || char === "\n") { finish(); resolveInput(value); return; }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else if (char >= " ") value += char;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("LOCAL_TERMINAL_REQUIRED");
  const path = resolve(".env");
  await readFile(path, "utf8");
  const client = createTelegramClient(true);
  // Suppress background library error output as well as its logger.
  client.onError = async () => {};
  try {
    await client.start({
      phoneNumber: () => secretPrompt("Telegram phone number including country code"),
      phoneCode: () => secretPrompt("Telegram login code"),
      password: () => secretPrompt("Telegram two-step verification password"),
      onError: async () => { throw new Error("AUTHORIZATION_FAILED"); },
    });
    if (!await client.checkAuthorization()) throw new Error("AUTHORIZATION_FAILED");
    const session = client.session.save() as unknown as string;
    if (typeof session !== "string" || !session || /[\r\n]/.test(session)) throw new Error("SESSION_INVALID");
    // Re-read after interaction to preserve any unrelated local edits made meanwhile.
    let content = await readFile(path, "utf8");
    for (const [key, value] of Object.entries({ TELEGRAM_SESSION: session, SHADOW_MODE: "true" })) {
      const pattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[^\\r\\n]*`, "gm");
      const line = `${key}=${value}`;
      content = pattern.test(content) ? content.replace(pattern, () => line)
        : content + (content.endsWith("\n") ? "" : "\r\n") + line + "\r\n";
    }
    await writeFile(path, content, { encoding: "utf8", mode: 0o600 });
    console.log("Authorized. Session saved only in ignored .env. Shadow mode enabled. No ingestion or publishing started.");
  } finally { await client.destroy(); }
}
main().catch(() => {
  console.error("Telegram authorization did not finish. No secret details were logged. Check credentials/connection and retry locally.");
  process.exitCode = 1;
});
