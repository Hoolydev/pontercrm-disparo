import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { classifyScore, newId } from "@pointer/shared";
import type { LeadClassification } from "@pointer/shared";
import { eq, sql } from "drizzle-orm";

/** Per-signal deltas for in-conversation events. Decay is computed separately. */
export const SCORE_DELTAS = {
  replied: 5,
  asked_visit: 20,
  mentioned_price: 15,
  mentioned_financing: 10,
  scheduled_visit: 30,
  visit_confirmed: 10,
  refused: -100
} as const;

export type ScoreSignal = keyof typeof SCORE_DELTAS;

export function detectSignalsFromMessage(text: string): ScoreSignal[] {
  const t = text.toLowerCase();
  const out: ScoreSignal[] = ["replied"];

  if (/\b(não tenho interesse|sem interesse|parar de receber|não quero|cancela)\b/.test(t)) {
    return ["refused"];
  }
  if (/\b(visita|visitar|agendar|conhecer o im[oó]vel|quero ver)\b/.test(t)) {
    out.push("asked_visit");
  }
  if (/\b(pre[cç]o|valor|quanto custa|quanto fica|qual o valor)\b/.test(t)) {
    out.push("mentioned_price");
  }
  if (/\b(financiamento|financiar|fgts|entrada|parcelar)\b/.test(t)) {
    out.push("mentioned_financing");
  }
  return out;
}

/**
 * Atomic increment + audit row. Re-classifies. Score floor is 0.
 */
export async function applyScoreSignal(
  db: Database,
  opts: {
    leadId: string;
    event: string;
    delta: number;
    source?: "system" | "ai_signal" | "manual";
    metadata?: Record<string, unknown>;
  }
): Promise<{ score: number; classification: LeadClassification }> {
  const source = opts.source ?? "system";
  const now = new Date();

  await db.insert(schema.leadScoreEvents).values({
    id: newId(),
    leadId: opts.leadId,
    event: opts.event,
    delta: opts.delta,
    source,
    metadataJson: opts.metadata
  });

  const existing = await db.query.leadScores.findFirst({
    where: eq(schema.leadScores.leadId, opts.leadId)
  });

  let nextScore: number;
  if (!existing) {
    nextScore = Math.max(0, opts.delta);
    await db.insert(schema.leadScores).values({
      leadId: opts.leadId,
      score: nextScore,
      classification: classifyScore(nextScore),
      lastEventAt: now,
      updatedAt: now
    });
  } else {
    nextScore = Math.max(0, existing.score + opts.delta);
    await db
      .update(schema.leadScores)
      .set({
        score: nextScore,
        classification: classifyScore(nextScore),
        lastEventAt: now,
        updatedAt: now
      })
      .where(eq(schema.leadScores.leadId, opts.leadId));
  }

  return { score: nextScore, classification: classifyScore(nextScore) };
}

export async function applyMessageSignals(
  db: Database,
  leadId: string,
  text: string,
  metadata?: Record<string, unknown>
) {
  const signals = detectSignalsFromMessage(text);
  for (const sig of signals) {
    await applyScoreSignal(db, {
      leadId,
      event: sig,
      delta: SCORE_DELTAS[sig],
      source: "system",
      metadata
    });
  }
  return signals;
}

/**
 * Progressive decay curve. Bigger penalty the longer a lead stays silent.
 *   < 1 day  → 0
 *   1 day    → -2
 *   2 days   → -3
 *   3-7 days → -5
 *   8-14     → -8
 *   15+      → -12
 */
export function progressiveDecayDelta(daysSinceLastEvent: number): number {
  if (daysSinceLastEvent < 1) return 0;
  if (daysSinceLastEvent < 2) return -2;
  if (daysSinceLastEvent < 3) return -3;
  if (daysSinceLastEvent < 8) return -5;
  if (daysSinceLastEvent < 15) return -8;
  return -12;
}

/**
 * Daily decay sweep. For each lead with last_event_at older than 24h and no
 * `decay` event applied in the last 24h, apply the progressive penalty.
 *
 * Skips leads whose pipeline_stage.category is 'won' or 'lost' — they're done.
 */
export async function applyProgressiveDecay(
  db: Database,
  opts: { batch?: number } = {}
): Promise<{ processed: number; totalDelta: number }> {
  const batch = opts.batch ?? 500;
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const candidates = await db.execute<{ lead_id: string; days: number }>(sql`
    SELECT l.id AS lead_id,
           EXTRACT(EPOCH FROM (now() - COALESCE(ls.last_event_at, l.created_at))) / 86400.0 AS days
    FROM ${schema.leads} l
    LEFT JOIN ${schema.leadScores} ls ON ls.lead_id = l.id
    JOIN ${schema.pipelineStages} ps ON ps.id = l.pipeline_stage_id
    WHERE ps.category = 'open'
      AND COALESCE(ls.last_event_at, l.created_at) < ${cutoff24h.toISOString()}
      AND NOT EXISTS (
        SELECT 1 FROM ${schema.leadScoreEvents} e
         WHERE e.lead_id = l.id
           AND e.event = 'decay'
           AND e.created_at > ${cutoff24h.toISOString()}
      )
    LIMIT ${batch}
  `);

  const list = Array.isArray(candidates)
    ? (candidates as Array<{ lead_id: string; days: number }>)
    : (candidates as { rows: Array<{ lead_id: string; days: number }> }).rows;

  let totalDelta = 0;
  for (const r of list) {
    const days = Math.floor(Number(r.days ?? 0));
    const delta = progressiveDecayDelta(days);
    if (delta === 0) continue;
    await applyScoreSignal(db, {
      leadId: r.lead_id,
      event: "decay",
      delta,
      source: "system",
      metadata: { daysSilent: days }
    });
    totalDelta += delta;
  }
  return { processed: list.length, totalDelta };
}
