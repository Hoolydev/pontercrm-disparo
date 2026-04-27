import { createDb, schema } from "@pointer/db";
import { eq, and } from "drizzle-orm";
import { newId } from "@pointer/shared";
import { cancelPendingFollowups } from "@pointer/agent-engine";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const brokers = await db.query.brokers.findMany();
  const b1 = brokers[0];

  // Get a conversation
  const conv = await db.query.conversations.findFirst();
  if (!conv) { console.error("No conv"); process.exit(1); }

  console.log("Setting up conversation for Follow-up Test...");
  const past31 = new Date(Date.now() - 31 * 60 * 1000);
  
  await db.update(schema.conversations)
    .set({ 
      assignedBrokerId: b1.id, 
      status: "handed_off",
      handoffReason: "test_followup",
      lastMessageAt: past31, // Simulate that the last message was 31 mins ago
      aiPaused: true 
    })
    .where(eq(schema.conversations.id, conv.id));

  // The scheduler creates followups when handoff happens. We need to create the followups.
  // Or we can just insert them directly to simulate what brokerNotify does.
  await db.insert(schema.leadFollowups).values({
    id: newId(),
    leadId: conv.leadId,
    brokerId: b1.id,
    conversationId: conv.id,
    step: "broker_30min",
    scheduledFor: past31, // it was scheduled for 1 minute ago (since handoff + 30m = 1 minute ago)
    status: "pending"
  }).onConflictDoNothing();

  console.log("Followup pending created for broker_30min.");

  // We will run the followup-scheduler logic (which sweeps for pending followups)
  const pending = await db.query.leadFollowups.findMany({
    where: and(
      eq(schema.leadFollowups.status, "pending"),
      eq(schema.leadFollowups.step, "broker_30min")
    )
  });
  
  console.log(`Found ${pending.length} pending followups`);
  
  // Mark it sent manually as the processor would
  for (const p of pending) {
    await db.update(schema.leadFollowups).set({ status: "sent" }).where(eq(schema.leadFollowups.id, p.id));
    console.log(`Followup ${p.id} executed (sent).`);
  }

  // Now the broker replies!
  console.log("Broker responds. Canceling pending...");
  
  // We need to insert a pending followup to see if it gets canceled
  const f2 = newId();
  await db.insert(schema.leadFollowups).values({
    id: f2,
    leadId: conv.leadId,
    brokerId: b1.id,
    conversationId: conv.id,
    step: "broker_24h",
    scheduledFor: new Date(Date.now() + 24 * 3600 * 1000),
    status: "pending"
  });

  const checkBefore = await db.query.leadFollowups.findFirst({ where: eq(schema.leadFollowups.id, f2) });
  console.log('f2 before cancel:', { id: checkBefore?.id, status: checkBefore?.status, brokerId: checkBefore?.brokerId, conversationId: checkBefore?.conversationId });
  
  // cancelPendingFollowups = cancel by conversationId (broker responded to this conv)
  const cancelResult = await cancelPendingFollowups(db, conv.id, "broker_responded");
  
  console.log(`cancelPendingFollowups result:`, cancelResult);
  
  const checkCanceled = await db.query.leadFollowups.findFirst({ where: eq(schema.leadFollowups.id, f2) });
  if (checkCanceled?.status === "cancelled") {
    console.log("SUCCESS: follow-up f2 was cancelled after broker responded.");
  } else {
    console.error(`FAIL: f2 status is still '${checkCanceled?.status}'`);
  }

  process.exit(0);
}

run().catch(console.error);
