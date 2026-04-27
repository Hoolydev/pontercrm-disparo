import { createDb, type Database } from "@pointer/db";
import { config } from "./config.js";

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  _db = createDb(config.DATABASE_URL);
  return _db;
}
