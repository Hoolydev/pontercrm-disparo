/**
 * Etapa E — Watchdog + Auto-stop
 * 1. Insert a broker_queue row that already timed out (timeoutAt = past)
 * 2. Run processDistributionWatchdog directly
 * 3. Assert: old row → 'timeout', lead redistributed to next broker
 * 4. Move lead to "Ganho" (won stage), assert pending followups cancelled
 */
import { createDb, schema } from "@pointer/db";
import { processDistributionWatchdog } from "../../worker/src/jobs/distribution-watchdog.js";
import { createBrokerFollowups, isLeadInFinalStage, cancelPendingFollowupsForLead } from "@pointer/agent-engine";
import { eq, and } from "drizzle-orm";
import { newId } from "@pointer/shared";
import pino from "pino";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);
const logger = pino({ level: "info" });

// Mock publisher
const publisher = {
  publish: async (_ch: string, _msg: string) => 0
} as any;

async function run() {
  const brokers = await db.query.brokers.findMany();
  const b1 = brokers[0];
  const b2 = brokers[1];
  const conv = await db.query.conversations.findFirst({ with: { lead: true } });
  if (!conv || !conv.lead) { console.error("No conversation"); process.exit(1); }

  console.log(`=== Etapa E: Watchdog ===`);

  // 1. Insert a timed-out broker_queue row (timeoutAt 16min ago)
  const past16 = new Date(Date.now() - 16 * 60 * 1000);
  const queueRowId = newId();
  await db.insert(schema.brokerQueue).values({
    id: queueRowId,
    leadId: conv.leadId,
    brokerId: b1.id,
    conversationId: conv.id,
    status: "pending",
    priorityHint: "normal",
    assignedAt: new Date(Date.now() - 31 * 60 * 1000),
    timeoutAt: past16,   // already expired
    attempts: 1,
    reason: "test_watchdog"
  });
  console.log(`Inserted expired broker_queue row: ${queueRowId}`);

  // 2. Create a pending followup for b1 so we can verify it gets cancelled
  const followupId = newId();
  await db.insert(schema.leadFollowups).values({
    id: followupId,
    leadId: conv.leadId,
    brokerId: b1.id,
    conversationId: conv.id,
    step: "broker_30min",
    scheduledFor: new Date(Date.now() + 30 * 60 * 1000),
    status: "pending"
  });
  console.log(`Inserted pending followup: ${followupId}`);

  // 3. Run the watchdog
  console.log(`Running processDistributionWatchdog...`);
  await processDistributionWatchdog(null, db, publisher, logger);

  // 4. Assert: old queue row is 'timeout'
  const updatedRow = await db.query.brokerQueue.findFirst({ where: eq(schema.brokerQueue.id, queueRowId) });
  if (updatedRow?.status === "timeout") {
    console.log(`SUCCESS: broker_queue row is now 'timeout'`);
  } else {
    console.error(`FAIL: broker_queue row status = '${updatedRow?.status}'`);
  }

  // 5. Assert: followup was cancelled
  const updatedFollowup = await db.query.leadFollowups.findFirst({ where: eq(schema.leadFollowups.id, followupId) });
  if (updatedFollowup?.status === "cancelled") {
    console.log(`SUCCESS: followup cancelled after timeout`);
  } else {
    console.error(`FAIL: followup status = '${updatedFollowup?.status}'`);
  }

  // 6. Assert: a new broker_queue row was created for another broker
  const newAssignment = await db.query.brokerQueue.findFirst({
    where: and(
      eq(schema.brokerQueue.leadId, conv.leadId),
      eq(schema.brokerQueue.status, "pending")
    )
  });
  if (newAssignment && newAssignment.brokerId !== b1.id) {
    console.log(`SUCCESS: Lead redistributed to broker ${newAssignment.brokerId} (attempt ${newAssignment.attempts})`);
  } else {
    console.error(`FAIL: No redistribution found`);
  }

  // ====== Auto-stop: Move lead to "Ganho" → cancel followups ======
  console.log(`\n=== Auto-stop: Move lead to "Ganho" stage ===`);

  // Create fresh pending followups first
  const fId = newId();
  await db.insert(schema.leadFollowups).values({
    id: fId,
    leadId: conv.leadId,
    brokerId: b1.id,
    conversationId: conv.id,
    step: "broker_24h",
    scheduledFor: new Date(Date.now() + 24 * 3600 * 1000),
    status: "pending"
  });
  console.log(`Created pending followup: ${fId}`);

  // Find the "won" pipeline stage
  const wonStage = await db.query.pipelineStages.findFirst({
    where: eq(schema.pipelineStages.category, "won")
  });
  if (!wonStage) { console.error("No won stage found"); process.exit(1); }

  // Move lead to won
  await db.update(schema.leads).set({ pipelineStageId: wonStage.id }).where(eq(schema.leads.id, conv.leadId));
  console.log(`Lead moved to "Ganho" stage (${wonStage.name})`);

  // Now cancel followups for the lead
  const cancelResult = await cancelPendingFollowupsForLead(db, conv.leadId, "lead_won");
  console.log(`cancelPendingFollowupsForLead result:`, cancelResult);

  const afterCancel = await db.query.leadFollowups.findFirst({ where: eq(schema.leadFollowups.id, fId) });
  if (afterCancel?.status === "cancelled") {
    console.log(`SUCCESS: followup was cancelled after lead moved to "Ganho"`);
  } else {
    console.error(`FAIL: followup status = '${afterCancel?.status}'`);
  }

  // Verify isLeadInFinalStage
  const isFinal = await isLeadInFinalStage(db, conv.leadId);
  console.log(`isLeadInFinalStage = ${isFinal} (expected: true)`);

  process.exit(0);
}

run().catch(console.error);
