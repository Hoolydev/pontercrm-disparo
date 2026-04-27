import { Redis } from "ioredis";

let _connection: Redis | null = null;

export function getRedis(url = process.env.REDIS_URL): Redis {
  if (_connection) return _connection;
  if (!url) throw new Error("REDIS_URL is required");
  _connection = new Redis(url, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: true
  });
  return _connection;
}
