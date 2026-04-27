import { createDb, schema } from "@pointer/db";
import { pickBrokerForLead, recordBrokerAssignment } from "@pointer/agent-engine";
import { eq } from "drizzle-orm";
import { newId } from "@pointer/shared";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const users = await db.query.users.findMany({ where: eq(schema.users.role, "broker") });
  for (let i = 0; i < users.length; i++) {
    const u = users[i];
    await db.insert(schema.brokers).values({
      id: newId(),
      userId: u.id,
      displayName: `Broker ${i + 1}`,
      active: true,
      roundRobinWeight: 1,
      maxActiveLeads: i === 2 ? 10 : 3
    }).onConflictDoNothing();
  }

  const brokers = await db.query.brokers.findMany();
  const b1 = brokers[0];
  console.log("Broker 1:", b1.id, "max leads:", b1.maxActiveLeads);

  const convs = await db.query.conversations.findMany({ limit: 4 });
  for (let i = 0; i < 3; i++) {
    await db.update(schema.conversations)
      .set({ assignedBrokerId: b1.id, status: "ai_active" })
      .where(eq(schema.conversations.id, convs[i].id));
  }
  console.log("Assigned 3 leads to", b1.id);

  const targetConv = convs[3];
  
  // pick broker with high priority hint (80% capacity)
  console.log("Picking broker with priority 'high'...");
  const pickedId = await pickBrokerForLead(db, { priorityHint: "high" });
  console.log("Picked broker:", pickedId);
  
  if (pickedId === b1.id) {
    console.error("FAIL: Picked broker 1 despite being at capacity for high priority!");
  } else {
    console.log("SUCCESS: Broker 1 was skipped.");
  }
  
  if (pickedId) {
    const queue = await recordBrokerAssignment(db, {
      leadId: targetConv.leadId,
      brokerId: pickedId,
      conversationId: targetConv.id,
      priorityHint: "high"
    });
    
    const item = await db.query.brokerQueue.findFirst({ where: eq(schema.brokerQueue.id, queue.id) });
    if (item && item.timeoutAt && item.assignedAt) {
      const diffMinutes = Math.round((item.timeoutAt.getTime() - item.assignedAt.getTime()) / 60000);
      console.log(`Timeout recorded: ${diffMinutes} minutes`);
    }
  }

  process.exit(0);
}

run().catch(console.error);
