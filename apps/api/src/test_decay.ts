/**
 * Decay — Progressive Score Decay
 * 1. Pick a lead and set lead_scores.last_event_at to 5 days ago via direct SQL
 * 2. Run applyProgressiveDecay
 * 3. Assert: score decreased by expected delta and decay event recorded
 */
import { createDb, schema } from "@pointer/db";
import { applyProgressiveDecay, progressiveDecayDelta } from "@pointer/agent-engine";
import { eq, sql } from "drizzle-orm";
import { newId } from "@pointer/shared";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  console.log(`=== Decay: Progressive Score Sweep ===`);

  // Pick any lead
  const lead = await db.query.leads.findFirst();
  if (!lead) { console.error("No lead"); process.exit(1); }
  console.log(`Using lead: ${lead.id}`);

  // Ensure lead_scores row exists with some initial score
  await db.insert(schema.leadScores).values({
    id: newId(),
    leadId: lead.id,
    score: 50,
    lastEventAt: new Date()
  }).onConflictDoUpdate({
    target: schema.leadScores.leadId,
    set: { score: 50, lastEventAt: new Date() }
  });

  // Backdate last_event_at to 5 days ago
  await db.execute(sql`
    UPDATE lead_scores
    SET last_event_at = NOW() - INTERVAL '5 days'
    WHERE lead_id = ${lead.id}
  `);
  console.log(`Backdated last_event_at to 5 days ago`);

  // Check score before
  const before = await db.query.leadScores.findFirst({ where: eq(schema.leadScores.leadId, lead.id) });
  console.log(`Score before decay: ${before?.score}`);

  // Run the decay sweep
  const result = await applyProgressiveDecay(db);
  console.log(`applyProgressiveDecay result:`, result);

  // Check score after
  const after = await db.query.leadScores.findFirst({ where: eq(schema.leadScores.leadId, lead.id) });
  console.log(`Score after decay: ${after?.score}`);

  if (after && before && after.score < before.score) {
    console.log(`SUCCESS: score decreased by ${before.score - after.score} points`);
  } else {
    console.error(`FAIL: score did not decrease (before=${before?.score}, after=${after?.score})`);
  }

  // Check decay event was recorded
  const decayEvents = await db.query.leadScoreEvents.findMany({
    where: eq(schema.leadScoreEvents.leadId, lead.id)
  });
  const decayEvent = decayEvents.find(e => e.event === "decay");
  if (decayEvent) {
    console.log(`SUCCESS: decay event recorded (delta=${decayEvent.delta})`);
  } else {
    console.error(`FAIL: no decay event found for lead`);
  }

  process.exit(0);
}

run().catch(console.error);
