import { spawnSync } from "node:child_process";

// Use the direct Neon connection for Prisma CLI operations without changing
// the application's pooled DATABASE_URL or the existing Prisma schema.
const command = process.argv[2];
const commands = { migrate: ["migrate", "deploy"], status: ["migrate", "status"] };
if (!commands[command]) throw new Error("Expected migrate or status");
const directUrl = process.env.DATABASE_URL_UNPOOLED;
if (!directUrl) throw new Error("DATABASE_URL_UNPOOLED is required; run neon env pull --file .env");
const url = new URL(directUrl);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler')) {
  throw new Error("A direct PostgreSQL URL is required");
}
const result = spawnSync(process.execPath, ["node_modules/prisma/build/index.js", ...commands[command]], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: directUrl },
});
if (result.error) throw new Error("Could not start Prisma CLI");
process.exitCode = result.status ?? 1;
