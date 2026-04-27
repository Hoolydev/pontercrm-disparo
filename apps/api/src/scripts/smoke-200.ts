/* eslint-disable no-console */
/**
 * Smoke test — Item 3 do roadmap pós-validação.
 *
 * Drives a 200-lead campaign through the full pipeline (seeder → blast →
 * conversation creation) and asserts state-machine invariants. Stops *before*
 * the WhatsApp send leg so it doesn't require a real connected instance.
 *
 *   $ pnpm --filter @pointer/api smoke
 *
 * Requires DATABASE_URL + REDIS_URL in env, and the worker process running so
 * the seeder/blast queues drain.
 */
import { schema } from "@pointer/db";
import { createDb } from "@pointer/db";
import { encryptJson, newId, normalizeE164 } from "@pointer/shared";
import { count, eq, sql } from "drizzle-orm";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const SUITE_NAME = "smoke-200";
const TARGET_LEADS = 200;
const MPM = 60; // 60 msgs/min so the seeder queues all 200 in ~3-4s
const POLL_INTERVAL_MS = 1_500;
const TIMEOUT_MS = 300_000; // 200 leads @ 60 mpm = ~3.5 min drain minimum

const dbUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const encKey =
  process.env.ENCRYPTION_KEY ?? "smoke-test-encryption-key-32chars!";

if (!dbUrl) throw new Error("DATABASE_URL is required");
if (!redisUrl) throw new Error("REDIS_URL is required");

const db = createDb(dbUrl);
const redisConn = new Redis(redisUrl, { maxRetriesPerRequest: null });
const redisQueueOpts = { connection: redisConn };

type AssertResult = { name: string; ok: boolean; detail?: string };

async function main() {
  const results: AssertResult[] = [];
  console.log(`[${SUITE_NAME}] starting…`);

  // ── Cleanup any prior smoke fixtures ───────────────────────────────────
  console.log(`[${SUITE_NAME}] cleaning previous fixtures…`);
  await db.execute(sql`
    DELETE FROM ${schema.campaignLeads}
    WHERE campaign_id IN (SELECT id FROM ${schema.campaigns} WHERE name = ${SUITE_NAME})
  `);
  await db.execute(sql`
    DELETE FROM ${schema.conversations}
    WHERE campaign_id IN (SELECT id FROM ${schema.campaigns} WHERE name = ${SUITE_NAME})
  `);
  await db.execute(sql`
    DELETE FROM ${schema.campaignInstances}
    WHERE campaign_id IN (SELECT id FROM ${schema.campaigns} WHERE name = ${SUITE_NAME})
  `);
  await db.execute(sql`DELETE FROM ${schema.campaigns} WHERE name = ${SUITE_NAME}`);
  await db.execute(sql`DELETE FROM ${schema.leads} WHERE name LIKE 'smoke-test-lead-%'`);
  await db.execute(sql`DELETE FROM ${schema.whatsappInstances} WHERE number = '+5511999999999'`);
  await db.execute(sql`DELETE FROM ${schema.leadSources} WHERE name = 'smoke-source'`);

  // ── Bootstrap fixtures ─────────────────────────────────────────────────
  const inboundAgent = await db.query.agents.findFirst({
    where: eq(schema.agents.type, "inbound")
  });
  const outboundAgent = await db.query.agents.findFirst({
    where: eq(schema.agents.type, "outbound")
  });
  if (!inboundAgent || !outboundAgent) {
    throw new Error(
      "smoke: need at least 1 inbound + 1 outbound agent in DB. Run `pnpm db:seed` first."
    );
  }

  const pipeline = await db.query.pipelines.findFirst({
    where: eq(schema.pipelines.isDefault, true),
    with: { stages: true }
  });
  if (!pipeline) throw new Error("smoke: no default pipeline found");
  const firstStage = pipeline.stages.find((s) => s.position === 1) ?? pipeline.stages[0];
  if (!firstStage) throw new Error("smoke: default pipeline has no stages");

  // Source for leads
  const sourceId = newId();
  await db.insert(schema.leadSources).values({
    id: sourceId,
    type: "smoke",
    name: "smoke-source",
    webhookSecret: "smoke-secret-32-bytes-for-hmac-validate-ok",
    active: true,
    configJson: {}
  });

  // Connected instance (config is bogus on purpose — smoke doesn't actually send)
  const instanceId = newId();
  await db.insert(schema.whatsappInstances).values({
    id: instanceId,
    provider: "uazapi",
    externalId: "smoke-instance",
    number: "+5511999999999",
    status: "connected",
    rateLimitPerMinute: 60,
    configJson: encryptJson({ baseUrl: "http://invalid.smoke/", token: "smoke" }, encKey),
    active: true
  });

  // Campaign
  const campaignId = newId();
  await db.insert(schema.campaigns).values({
    id: campaignId,
    name: SUITE_NAME,
    status: "active", // start active so the seeder we enqueue below picks it up
    outboundAgentId: outboundAgent.id,
    inboundAgentId: inboundAgent.id,
    pipelineId: pipeline.id,
    settingsJson: { max_messages_per_minute: MPM, send_media: false }
  });
  await db.insert(schema.campaignInstances).values({
    campaignId,
    instanceId
  });

  // 200 leads + campaign_leads
  console.log(`[${SUITE_NAME}] inserting ${TARGET_LEADS} leads…`);
  const t0 = Date.now();
  const leadRows = Array.from({ length: TARGET_LEADS }, (_, i) => ({
    id: newId(),
    sourceId,
    pipelineStageId: firstStage.id,
    name: `smoke-test-lead-${String(i).padStart(4, "0")}`,
    phone: normalizeE164(`+5511${String(700000000 + i).padStart(9, "0")}`),
    metadataJson: { suite: SUITE_NAME }
  }));

  // Insert in chunks of 100 to keep the params under PG's limit comfortably.
  for (let i = 0; i < leadRows.length; i += 100) {
    await db.insert(schema.leads).values(leadRows.slice(i, i + 100));
  }
  await db.insert(schema.campaignLeads).values(
    leadRows.map((l) => ({
      id: newId(),
      campaignId,
      leadId: l.id,
      state: "pending" as const
    }))
  );
  console.log(
    `[${SUITE_NAME}] fixtures ready in ${(Date.now() - t0) / 1000}s — campaign=${campaignId}`
  );

  // ── Trigger seeder ─────────────────────────────────────────────────────
  const seederQ = new Queue("outbound-blast-seeder", redisQueueOpts);
  await seederQ.add(
    `seed-${campaignId}`,
    { campaignId },
    { jobId: `smoke-seed-${campaignId}` }
  );
  console.log(`[${SUITE_NAME}] seeder enqueued — waiting for state transitions…`);

  // ── Poll until all campaign_leads leave pending+queued ────────────────
  const tStart = Date.now();
  let lastSummary: Record<string, number> = {};
  while (true) {
    const rows = await db
      .select({ state: schema.campaignLeads.state, n: count() })
      .from(schema.campaignLeads)
      .where(eq(schema.campaignLeads.campaignId, campaignId))
      .groupBy(schema.campaignLeads.state);
    lastSummary = Object.fromEntries(rows.map((r) => [r.state, Number(r.n)]));
    const waiting = (lastSummary.pending ?? 0) + (lastSummary.queued ?? 0);
    process.stdout.write(`\r[${SUITE_NAME}] states: ${JSON.stringify(lastSummary)}   `);
    if (waiting === 0) break;
    if (Date.now() - tStart > TIMEOUT_MS) {
      console.log("");
      console.log(`[${SUITE_NAME}] ⏱  TIMEOUT after ${TIMEOUT_MS / 1000}s`);
      results.push({
        name: "drain_within_timeout",
        ok: false,
        detail: `still waiting=${waiting} after ${TIMEOUT_MS / 1000}s`
      });
      break;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  console.log("");

  if (lastSummary.pending === 0 && lastSummary.queued === 0) {
    results.push({ name: "drain_within_timeout", ok: true });
  }

  // ── Asserts ────────────────────────────────────────────────────────────
  const totalLeads = await db
    .select({ n: count() })
    .from(schema.campaignLeads)
    .where(eq(schema.campaignLeads.campaignId, campaignId));
  results.push({
    name: "campaign_leads_count_eq_200",
    ok: Number(totalLeads[0]?.n) === TARGET_LEADS,
    detail: `got ${totalLeads[0]?.n}`
  });

  const dispatched =
    (lastSummary.dispatched ?? 0) + (lastSummary.replied ?? 0) + (lastSummary.failed ?? 0);
  results.push({
    name: "all_leads_dispatched",
    ok: dispatched === TARGET_LEADS,
    detail: `dispatched=${dispatched} of ${TARGET_LEADS}`
  });

  // No (campaign_id, lead_id) duplicates — UNIQUE index guarantees it, but
  // explicit check guards against future schema drift.
  const dupes = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM (
      SELECT lead_id, count(*) c FROM ${schema.campaignLeads}
      WHERE campaign_id = ${campaignId}
      GROUP BY lead_id HAVING count(*) > 1
    ) x
  `);
  const dupesCount = Number(toRows(dupes)[0]?.n ?? 0);
  results.push({
    name: "no_lead_duplicates",
    ok: dupesCount === 0,
    detail: dupesCount > 0 ? `${dupesCount} duplicates found` : undefined
  });

  // 1 conversation per (lead, campaign).
  const convCount = await db
    .select({ n: count() })
    .from(schema.conversations)
    .where(eq(schema.conversations.campaignId, campaignId));
  results.push({
    name: "one_conversation_per_lead",
    ok: Number(convCount[0]?.n) === TARGET_LEADS,
    detail: `conversations=${convCount[0]?.n}`
  });

  // Rate-limit respect: among the scheduled_at distribution, no minute window
  // has more than MPM rows. We compute the distribution on the rows that
  // actually got `scheduled_at` (queued/dispatched/replied/failed).
  const minuteRows = await db.execute<{ minute: string; n: number }>(sql`
    SELECT date_trunc('minute', scheduled_at) AS minute, count(*)::int AS n
    FROM ${schema.campaignLeads}
    WHERE campaign_id = ${campaignId} AND scheduled_at IS NOT NULL
    GROUP BY 1
    ORDER BY 1
  `);
  const minuteList = toRows(minuteRows);
  const overflow = minuteList.find((r) => Number(r.n) > MPM);
  results.push({
    name: "scheduled_at_respects_mpm",
    ok: !overflow,
    detail: overflow
      ? `minute ${overflow.minute} has ${overflow.n} (> mpm=${MPM})`
      : `${minuteList.length} minute buckets, max=${
          minuteList.reduce((m, r) => Math.max(m, Number(r.n)), 0)
        }`
  });

  // Conversation `mode` should be 'outbound_seed' for all
  const wrongMode = await db
    .select({ n: count() })
    .from(schema.conversations)
    .where(
      sql`${schema.conversations.campaignId} = ${campaignId} AND ${schema.conversations.mode} != 'outbound_seed'`
    );
  results.push({
    name: "conversations_mode_outbound_seed",
    ok: Number(wrongMode[0]?.n) === 0,
    detail: `wrong_mode=${wrongMode[0]?.n}`
  });

  // ── Report ─────────────────────────────────────────────────────────────
  console.log("");
  console.log(`[${SUITE_NAME}] results:`);
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "✅" : "❌";
    console.log(`  ${mark} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
    if (!r.ok) failed += 1;
  }
  console.log("");
  console.log(`[${SUITE_NAME}] ${results.length - failed}/${results.length} passed`);

  await seederQ.close();
  await redisConn.quit();
  process.exit(failed === 0 ? 0 : 1);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toRows<T>(result: T | { rows: T[] }): T[] {
  return Array.isArray(result) ? (result as unknown as T[]) : (result as { rows: T[] }).rows;
}

main().catch((err) => {
  console.error(`[${SUITE_NAME}] failed:`, err);
  process.exit(1);
});
