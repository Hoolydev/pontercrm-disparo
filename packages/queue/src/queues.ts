import { Queue } from "bullmq";
import { getRedis } from "./connection.js";
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
} from "./jobs.js";

export const QUEUE_NAMES = {
  inboundMessage: "inbound-message",
  aiReply: "ai-reply",
  outboundMessage: "outbound-message",
  handoffEvaluator: "handoff-evaluator",
  brokerNotify: "broker-notify",
  memorySummarize: "memory-summarize",
  followup: "followup-scheduler",
  outboundBlastSeeder: "outbound-blast-seeder",
  outboundBlast: "outbound-blast",
  followupProcessor: "followup-processor",
  distributionWatchdog: "distribution-watchdog",
  scoreSweep: "score-sweep",
  slaAlertsSweep: "sla-alerts-sweep"
} as const;

const defaultOpts = {
  connection: getRedis(),
  defaultJobOptions: {
    removeOnComplete: { age: 24 * 3600, count: 10_000 },
    removeOnFail: { age: 7 * 24 * 3600 },
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 2000 }
  }
};

let _queues: Queues | null = null;

export type Queues = {
  inboundMessage: Queue<InboundMessageJob>;
  aiReply: Queue<AiReplyJob>;
  outboundMessage: Queue<OutboundMessageJob>;
  handoffEvaluator: Queue<HandoffEvaluatorJob>;
  brokerNotify: Queue<BrokerNotifyJob>;
  memorySummarize: Queue<MemorySummarizeJob>;
  followup: Queue<FollowupJob>;
  outboundBlastSeeder: Queue<OutboundBlastSeederJob>;
  outboundBlast: Queue<OutboundBlastJob>;
  followupProcessor: Queue<FollowupProcessorJob>;
  distributionWatchdog: Queue<DistributionWatchdogJob>;
  scoreSweep: Queue<ScoreSweepJob>;
  slaAlertsSweep: Queue<SlaAlertsSweepJob>;
};

export function getQueues(): Queues {
  if (_queues) return _queues;
  _queues = {
    inboundMessage: new Queue(QUEUE_NAMES.inboundMessage, defaultOpts),
    aiReply: new Queue(QUEUE_NAMES.aiReply, defaultOpts),
    outboundMessage: new Queue(QUEUE_NAMES.outboundMessage, defaultOpts),
    handoffEvaluator: new Queue(QUEUE_NAMES.handoffEvaluator, defaultOpts),
    brokerNotify: new Queue(QUEUE_NAMES.brokerNotify, defaultOpts),
    memorySummarize: new Queue(QUEUE_NAMES.memorySummarize, defaultOpts),
    followup: new Queue(QUEUE_NAMES.followup, defaultOpts),
    outboundBlastSeeder: new Queue(QUEUE_NAMES.outboundBlastSeeder, defaultOpts),
    outboundBlast: new Queue(QUEUE_NAMES.outboundBlast, defaultOpts),
    followupProcessor: new Queue(QUEUE_NAMES.followupProcessor, defaultOpts),
    distributionWatchdog: new Queue(QUEUE_NAMES.distributionWatchdog, defaultOpts),
    scoreSweep: new Queue(QUEUE_NAMES.scoreSweep, defaultOpts),
    slaAlertsSweep: new Queue(QUEUE_NAMES.slaAlertsSweep, defaultOpts)
  };
  return _queues;
}
