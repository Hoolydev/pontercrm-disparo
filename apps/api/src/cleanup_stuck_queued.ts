/**
 * Mark all stuck "queued" outbound messages as "failed".
 * These are messages that were enqueued but never dispatched (retry timeouts,
 * duplicate clicks, disconnected instances, etc).
 *
 * Default: dry-run. Add --execute to apply.
 *
 *   cd apps/api && npx tsx --env-file=../../.env src/cleanup_stuck_queued.ts
 *   cd apps/api && npx tsx --env-file=../../.env src/cleanup_stuck_queued.ts --execute
 */
import { createDb, schema } from "@pointer/db";
import { and, eq, sql, lt } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(DATABASE_URL);

async function run() {
  const dryRun = !process.argv.includes("--execute");

  // Find all outbound messages stuck in "queued" older than 30 minutes
  const cutoff = new Date(Date.now() - 30 * 60_000);

  const stuck = await db
    .select({
      id: schema.messages.id,
      conversationId: schema.messages.conversationId,
      content: sql<string>`LEFT(${schema.messages.content}, 60)`,
      createdAt: schema.messages.createdAt
    })
    .from(schema.messages)
    .where(
      and(
        eq(schema.messages.direction, "out"),
        eq(schema.messages.status, "queued"),
        lt(schema.messages.createdAt, cutoff)
      )
    )
    .orderBy(schema.messages.createdAt);

  console.log(`Found ${stuck.length} stuck queued messages (older than 30min).`);

  if (stuck.length === 0) {
    console.log("Nothing to clean.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN: showing first 20 ---");
    for (const r of stuck.slice(0, 20)) {
      console.log(
        `  conv=${r.conversationId}  msg=${r.id}  created=${r.createdAt}  text="${r.content}..."`
      );
    }
    if (stuck.length > 20) console.log(`  … and ${stuck.length - 20} more`);
    console.log("\nRe-run with --execute to mark them as 'failed'.");
    process.exit(0);
  }

  // Mark all as failed in bulk
  const result = await db
    .update(schema.messages)
    .set({ status: "failed" })
    .where(
      and(
        eq(schema.messages.direction, "out"),
        eq(schema.messages.status, "queued"),
        lt(schema.messages.createdAt, cutoff)
      )
    )
    .returning({ id: schema.messages.id });

  console.log(`\nDone. Marked ${result.length} stuck messages as 'failed'.`);
  console.log("They will now show as failed in the chat instead of queued.");
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
