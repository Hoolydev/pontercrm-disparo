import "dotenv/config";
import { createDb } from "@pointer/db";
import { getQueues, getRedis, QUEUE_NAMES } from "@pointer/queue";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { processAiReply } from "./jobs/ai-reply.js";
import { processBrokerNotify } from "./jobs/broker-notify.js";
import { processDistributionWatchdog } from "./jobs/distribution-watchdog.js";
import { processFollowupSweep } from "./jobs/followup-processor.js";
import { processHandoffEvaluator } from "./jobs/handoff-evaluator.js";
import { processInboundMessage } from "./jobs/inbound-message.js";
import { processMemorySummarize } from "./jobs/memory-summarize.js";
import { processOutboundBlast } from "./jobs/outbound-blast.js";
import { processOutboundBlastSeeder } from "./jobs/outbound-blast-seeder.js";
import { processOutboundMessage } from "./jobs/outbound-message.js";
import { processScoreSweep } from "./jobs/score-sweep.js";
import { processSlaAlertsSweep } from "./jobs/sla-alerts-sweep.js";

import type {
  AiReplyJob,
  BrokerNotifyJob,
  DistributionWatchdogJob,
  FollowupJob,
  FollowupProcessorJob,
  HandoffEvaluatorJob,
  InboundMessageJob,
  MemorySummarizeJob,
  OutboundBlastJob,
  OutboundBlastSeederJob,
  OutboundMessageJob,
  ScoreSweepJob,
  SlaAlertsSweepJob
} from "@pointer/queue";

const logger = pino({
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined
});

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) { logger.error("DATABASE_URL missing"); process.exit(1); }

const db = createDb(dbUrl);
const connection = getRedis();
const publisher = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null });

const workers: Worker[] = [];

function attach<T>(name: string, handler: (data: T) => Promise<void>, concurrency = 5) {
  const w = new Worker<T>(
    name,
    async (job) => {
      logger.info({ queue: name, jobId: job.id }, "start");
      await handler(job.data);
      logger.info({ queue: name, jobId: job.id }, "done");
    },
    { connection, concurrency }
  );
  w.on("failed", (job, err) =>
    logger.error({ queue: name, jobId: job?.id, err: err.message }, "failed")
  );
  workers.push(w);
}

attach<InboundMessageJob>(QUEUE_NAMES.inboundMessage, (data) =>
  processInboundMessage(data, db, publisher, logger)
);
attach<OutboundMessageJob>(QUEUE_NAMES.outboundMessage, (data) =>
  processOutboundMessage(data, db, publisher, logger), 3
);
attach<AiReplyJob>(QUEUE_NAMES.aiReply, (data) =>
  processAiReply(data, db, publisher, logger), 3
);
attach<HandoffEvaluatorJob>(QUEUE_NAMES.handoffEvaluator, (data) =>
  processHandoffEvaluator(data, db, publisher, logger), 5
);
attach<MemorySummarizeJob>(QUEUE_NAMES.memorySummarize, (data) =>
  processMemorySummarize(data, db, logger), 2
);
attach<BrokerNotifyJob>(QUEUE_NAMES.brokerNotify, (data) =>
  processBrokerNotify(data, db, logger), 5
);
attach<OutboundBlastSeederJob>(QUEUE_NAMES.outboundBlastSeeder, (data) =>
  processOutboundBlastSeeder(data, db, logger), 1
);
attach<OutboundBlastJob>(QUEUE_NAMES.outboundBlast, (data) =>
  processOutboundBlast(data, db, logger), 5
);
attach<FollowupProcessorJob>(QUEUE_NAMES.followupProcessor, (data) =>
  processFollowupSweep(data, db, publisher, logger), 1
);
attach<DistributionWatchdogJob>(QUEUE_NAMES.distributionWatchdog, (data) =>
  processDistributionWatchdog(data, db, publisher, logger), 1
);
attach<ScoreSweepJob>(QUEUE_NAMES.scoreSweep, (data) =>
  processScoreSweep(data, db, logger), 1
);
attach<SlaAlertsSweepJob>(QUEUE_NAMES.slaAlertsSweep, (data) =>
  processSlaAlertsSweep(data, db, publisher, logger), 1
);
attach<FollowupJob>(QUEUE_NAMES.followup, async (data) => {
  if (data.reason === "rate-limit-reset") {
    const { schema } = await import("@pointer/db");
    await db.update(schema.whatsappInstances).set({ messagesSentLastMinute: 0 });
    logger.info("rate-limit-reset: counters cleared");
  }
});

// Repeatable jobs
(async () => {
  const queues = getQueues();

  await queues.followup.add(
    "rate-limit-reset",
    { conversationId: "__system__", reason: "rate-limit-reset" },
    { repeat: { every: 60_000 }, jobId: "rate-limit-reset" }
  );

  // Follow-up sweep: every 60s
  await queues.followupProcessor.add(
    "sweep",
    { tick: Date.now() },
    { repeat: { every: 60_000 }, jobId: "followup-sweep" }
  );

  // Distribution watchdog: every 30s
  await queues.distributionWatchdog.add(
    "watch",
    { tick: Date.now() },
    { repeat: { every: 30_000 }, jobId: "distribution-watch" }
  );

  // Score sweeps: 24h window every hour, 7d window once a day
  await queues.scoreSweep.add(
    "score-24h",
    { window: "24h" },
    { repeat: { every: 60 * 60_000 }, jobId: "score-sweep-24h" }
  );
  await queues.scoreSweep.add(
    "score-7d",
    { window: "7d" },
    { repeat: { every: 24 * 60 * 60_000 }, jobId: "score-sweep-7d" }
  );

  // SLA alerts: every 30 min
  await queues.slaAlertsSweep.add(
    "sla-sweep",
    { tick: Date.now() },
    { repeat: { every: 30 * 60_000 }, jobId: "sla-alerts-sweep" }
  );

  logger.info("worker: scheduled jobs ready (followups, watchdog, score-sweep, sla-alerts)");
})();

logger.info("worker: all queues attached");

async function shutdown(sig: string) {
  logger.info({ sig }, "shutdown");
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
