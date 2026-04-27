import { randomUUID } from "node:crypto";
import { getRedis } from "./connection.js";

// Lightweight single-node redlock. For multi-replica Redis, swap for `redlock`.
// TTL in ms. Returns a token that must be passed back to `release`.
export async function acquireLock(
  key: string,
  ttlMs: number,
  token = randomUUID()
): Promise<string | null> {
  const redis = getRedis();
  const ok = await redis.set(`lock:${key}`, token, "PX", ttlMs, "NX");
  return ok === "OK" ? token : null;
}

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function releaseLock(key: string, token: string): Promise<boolean> {
  const redis = getRedis();
  const r = (await redis.eval(RELEASE_SCRIPT, 1, `lock:${key}`, token)) as number;
  return r === 1;
}

const EXTEND_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], ARGV[2])
else
  return 0
end
`;

export async function extendLock(key: string, token: string, ttlMs: number): Promise<boolean> {
  const redis = getRedis();
  const r = (await redis.eval(
    EXTEND_SCRIPT,
    1,
    `lock:${key}`,
    token,
    String(ttlMs)
  )) as number;
  return r === 1;
}

export async function withLock<T>(
  key: string,
  ttlMs: number,
  fn: (token: string) => Promise<T>,
  opts: { retries?: number; retryDelayMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 5;
  const delay = opts.retryDelayMs ?? 200;

  for (let i = 0; i <= retries; i++) {
    const token = await acquireLock(key, ttlMs);
    if (token) {
      try {
        return await fn(token);
      } finally {
        await releaseLock(key, token).catch(() => void 0);
      }
    }
    await new Promise((r) => setTimeout(r, delay * (i + 1)));
  }
  throw new Error(`lock ${key} not acquired after ${retries} retries`);
}
