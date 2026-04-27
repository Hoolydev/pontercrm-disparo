import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { OutboundBlastSeederJob } from "@pointer/queue";
import { getQueues } from "@pointer/queue";
import { and, asc, eq } from "drizzle-orm";
import type { Logger } from "pino";

const BATCH = 500;
const DEFAULT_MPM = 20;

type BusinessHours = { start: string; end: string; tz: string };

function parseHHMM(s: string): number {
  const [h, m] = s.split(":");
  return parseInt(h ?? "0", 10) * 60 + parseInt(m ?? "0", 10);
}

/**
 * Returns the absolute Date when the next valid business-hours window starts,
 * given a candidate timestamp. If `bh` is undefined, returns `at` unchanged.
 *
 * Implementation note: we use `Intl.DateTimeFormat` to translate the candidate
 * into the local time of `bh.tz`, decide if it falls in [start, end], and if not
 * push to the next start. Edge-cases (DST transitions) are best-effort — Phase E
 * MVP, refined later if customers run multi-TZ campaigns.
 */
function clampToBusinessHours(at: Date, bh: BusinessHours | undefined): Date {
  if (!bh) return at;
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: bh.tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(at);

    const get = (k: string) => parts.find((p) => p.type === k)?.value ?? "";
    const hh = parseInt(get("hour"), 10);
    const mm = parseInt(get("minute"), 10);
    const localMinutes = hh * 60 + mm;

    const startMin = parseHHMM(bh.start);
    const endMin = parseHHMM(bh.end);

    if (localMinutes >= startMin && localMinutes <= endMin) return at;

    // Push to next start: compute minutes until next start, add to at.
    let deltaMin: number;
    if (localMinutes < startMin) {
      deltaMin = startMin - localMinutes;
    } else {
      // After end: tomorrow's start
      deltaMin = 24 * 60 - localMinutes + startMin;
    }
    return new Date(at.getTime() + deltaMin * 60_000);
  } catch {
    // If TZ parsing fails, don't block the seed.
    return at;
  }
}

export async function processOutboundBlastSeeder(
  job: OutboundBlastSeederJob,
  db: Database,
  logger: Logger
) {
  const { campaignId } = job;

  const camp = await db.query.campaigns.findFirst({
    where: eq(schema.campaigns.id, campaignId)
  });
  if (!camp) {
    logger.warn({ campaignId }, "seeder: campaign not found");
    return;
  }
  if (camp.status !== "active") {
    logger.info({ campaignId, status: camp.status }, "seeder: campaign not active — skip");
    return;
  }
  if (!camp.outboundAgentId || !camp.inboundAgentId) {
    logger.warn({ campaignId }, "seeder: campaign missing agents — skip");
    return;
  }

  const settings = camp.settingsJson ?? {};
  const mpm = settings.max_messages_per_minute ?? DEFAULT_MPM;
  const slotMs = (60 * 1000) / mpm;
  const bh = settings.business_hours;

  const queues = getQueues();

  let processed = 0;
  let cursorIndex = 0;

  // Loop until no more pending. Using offset paging is fine here because we
  // mutate state→queued in the same pass (rows fall out of the WHERE clause).
  while (true) {
    const pending = await db.query.campaignLeads.findMany({
      where: and(
        eq(schema.campaignLeads.campaignId, campaignId),
        eq(schema.campaignLeads.state, "pending")
      ),
      orderBy: [asc(schema.campaignLeads.createdAt)],
      limit: BATCH
    });
    if (pending.length === 0) break;

    const now = Date.now();
    for (const cl of pending) {
      cursorIndex += 1;
      const baseOffset = cursorIndex * slotMs;
      const jitter = (Math.random() * 0.4 - 0.2) * slotMs; // ±20%
      let scheduledAt = new Date(now + baseOffset + jitter);
      scheduledAt = clampToBusinessHours(scheduledAt, bh);
      const delay = Math.max(0, scheduledAt.getTime() - Date.now());

      await db
        .update(schema.campaignLeads)
        .set({ state: "queued", scheduledAt })
        .where(eq(schema.campaignLeads.id, cl.id));

      await queues.outboundBlast.add(
        `blast-${cl.id}`,
        { campaignId, campaignLeadId: cl.id },
        { delay, jobId: `blast-${cl.id}` }
      );
      processed += 1;
    }

    if (pending.length < BATCH) break;
  }

  logger.info({ campaignId, processed, mpm }, "seeder: done");
}
