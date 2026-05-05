/**
 * Cleanup script — remove duplicate outbound messages stuck in `queued` state.
 *
 * Background: when /conversations/retry-failed timed out at the gateway, the
 * client retried the click. Each click queued a fresh row + BullMQ job before
 * timing out, so conversations ended up with 3+ identical "queued" messages
 * (same content_hash) that haven't dispatched yet. This script keeps the
 * oldest per (conversation_id, content_hash) group, deletes the rest from
 * `messages`, and tries to remove their BullMQ jobs.
 *
 * Usage (default = dry-run, just reports counts):
 *
 *   pnpm --filter @pointer/api exec tsx src/cleanup_duplicate_queued.ts
 *
 * Add --execute to actually delete:
 *
 *   pnpm --filter @pointer/api exec tsx src/cleanup_duplicate_queued.ts --execute
 *
 * Run locally with DATABASE_URL + REDIS_URL env vars pointing at production.
 */
import { createDb, schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { inArray, sql } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
const db = createDb(DATABASE_URL);

type DupeRow = {
  id: string;
  conversation_id: string;
  content_hash: string;
  created_at: string;
};

async function run() {
  const dryRun = !process.argv.includes("--execute");

  const result = await db.execute<DupeRow>(sql`
    SELECT id, conversation_id, content_hash, created_at
    FROM (
      SELECT id, conversation_id, content_hash, created_at,
        ROW_NUMBER() OVER (
          PARTITION BY conversation_id, content_hash
          ORDER BY created_at ASC
        ) AS rn
      FROM messages
      WHERE direction = 'out'
        AND status = 'queued'
        AND content_hash IS NOT NULL
    ) t
    WHERE rn > 1
    ORDER BY conversation_id, created_at ASC
  `);

  const dupes = result.rows;
  const convCount = new Set(dupes.map((r) => r.conversation_id)).size;

  console.log(
    `Found ${dupes.length} duplicate queued messages across ${convCount} conversations.`
  );

  if (dupes.length === 0) {
    console.log("Nothing to clean.");
    process.exit(0);
  }

  if (dryRun) {
    console.log("\n--- DRY RUN: showing first 15 ---");
    for (const r of dupes.slice(0, 15)) {
      console.log(
        `  conv=${r.conversation_id}  hash=${r.content_hash.slice(0, 12)}  msg=${r.id}  createdAt=${r.created_at}`
      );
    }
    if (dupes.length > 15) console.log(`  … and ${dupes.length - 15} more`);
    console.log("\nRe-run with --execute to delete.");
    process.exit(0);
  }

  // Best-effort BullMQ job removal. The worker is idempotent (skips when the
  // message row no longer exists), so missing a job here only wastes a tick.
  const queues = getQueues();
  let removedJobs = 0;
  let scanned = 0;
  for (const r of dupes) {
    scanned++;
    if (scanned % 200 === 0) {
      console.log(`  ...scanned ${scanned}/${dupes.length} for jobs`);
    }
    const candidates = [
      `retry-${r.id}`,
      `ai-send-${r.id}`,
      `prop-${r.id}`,
      `camp-att-${r.id}`
    ];
    for (const jobId of candidates) {
      try {
        const job = await queues.outboundMessage.getJob(jobId);
        if (job) {
          await job.remove();
          removedJobs++;
          break;
        }
      } catch {
        // ignore — best-effort
      }
    }
  }
  console.log(`Removed ${removedJobs} BullMQ jobs (best-effort).`);

  // Chunked bulk DELETE — keeps the IN(...) parameter list bounded.
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

  console.log(`\nDone. Removed ${deleted} duplicate messages.`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
