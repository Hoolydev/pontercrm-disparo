import { createDb, schema } from "@pointer/db";
import { inArray, sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(DATABASE_URL);

async function run() {
  const dryRun = !process.argv.includes("--execute");

  // A failed/queued message is considered a duplicate if there is another message
  // in the same conversation with the EXACT SAME content that is either:
  // 1. Successful (sent, delivered, read)
  // 2. Also failed/queued, but created earlier (or same time with smaller ID)
  // 
  // We use "content" instead of "content_hash" because retries generate unique content_hashes.
  const result = await db.execute<{ id: string; conversation_id: string; content: string; status: string }>(sql`
    SELECT m.id, m.conversation_id, LEFT(m.content, 60) as content, m.status
    FROM messages m
    WHERE m.direction = 'out'
      AND m.status IN ('failed', 'queued')
      AND m.content IS NOT NULL
      AND m.content != ''
      AND EXISTS (
        SELECT 1 FROM messages m2
        WHERE m2.conversation_id = m.conversation_id
          AND m2.content = m.content
          AND m2.direction = 'out'
          AND m2.id != m.id
          AND (
            m2.status IN ('sent', 'delivered', 'read')
            OR
            (m2.status IN ('failed', 'queued') AND m2.created_at < m.created_at)
            OR
            (m2.status IN ('failed', 'queued') AND m2.created_at = m.created_at AND m2.id < m.id)
          )
      )
  `);

  const dupes = result.rows;

  console.log(`Found ${dupes.length} duplicate redundant messages to delete.`);

  if (dupes.length === 0) {
    console.log("Nothing to clean.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN: showing first 20 ---");
    for (const r of dupes.slice(0, 20)) {
      console.log(
        `  conv=${r.conversation_id}  msg=${r.id}  status=${r.status}  text="${r.content}..."`
      );
    }
    if (dupes.length > 20) console.log(`  … and ${dupes.length - 20} more`);
    console.log("\nRe-run with --execute to delete them.");
    process.exit(0);
  }

  const ids = dupes.map((r) => r.id);
  const CHUNK = 1000;
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    await db
      .delete(schema.messages)
      .where(inArray(schema.messages.id, chunk));
    deleted += chunk.length;
    console.log(`  deleted ${deleted}/${ids.length} rows`);
  }

  console.log(`\nDone. Deleted ${deleted} duplicate redundant messages.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
