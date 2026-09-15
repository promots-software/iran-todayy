import { createHash, timingSafeEqual } from "node:crypto";

function equals(left: string, right: string) {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export function authenticated(header: string | null, username = process.env.ADMIN_USERNAME, password = process.env.ADMIN_PASSWORD) {
  if (!username || !password || !header?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const userValid = equals(decoded.slice(0, separator), username);
    const passwordValid = equals(decoded.slice(separator + 1), password);
    return userValid && passwordValid;
  } catch { return false; }
}
