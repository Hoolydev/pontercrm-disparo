import { applyProgressiveDecay } from "@pointer/agent-engine";
import type { Database } from "@pointer/db";
import type { ScoreSweepJob } from "@pointer/queue";
import type { Logger } from "pino";

/**
 * Daily progressive decay. Curve in @pointer/agent-engine `progressiveDecayDelta`.
 * The job's `window` field is kept for API compatibility but the implementation
 * is now a single decay path — running it more often is harmless thanks to the
 * 24h "decay event" idempotency guard inside applyProgressiveDecay.
 */
export async function processScoreSweep(job: ScoreSweepJob, db: Database, logger: Logger) {
  const result = await applyProgressiveDecay(db);
  logger.info(
    { window: job.window, processed: result.processed, totalDelta: result.totalDelta },
    "score-sweep: decay applied"
  );
}
