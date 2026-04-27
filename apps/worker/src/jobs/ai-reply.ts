import { createAgentEngine } from "@pointer/agent-engine";
import type { Database } from "@pointer/db";
import type { AiReplyJob } from "@pointer/queue";
import type { Redis } from "ioredis";
import type { Logger } from "pino";

export async function processAiReply(
  job: AiReplyJob,
  db: Database,
  publisher: Redis,
  logger: Logger
) {
  const engine = createAgentEngine({ db, publisher, logger });
  await engine.run({
    conversationId: job.conversationId,
    mode: job.mode ?? "inbound",
    firstTouch: job.firstTouch,
    trigger: job.trigger ?? { kind: "webhook_inbound", refId: job.reason }
  });
}
