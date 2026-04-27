import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { count, eq, gte } from "drizzle-orm";

/**
 * Prometheus-compatible metrics, hand-rolled to avoid pulling `prom-client`
 * for what is currently a small surface. Returns text/plain in the standard
 * exposition format. Counters/gauges are read on demand from the DB and from
 * BullMQ — pull-style scrape, not in-process counters. This is fine for our
 * scale (single-tenant). Move to prom-client if cardinality explodes.
 */
import type { Queues } from "@pointer/queue";

type Sample = {
  name: string;
  help: string;
  type: "counter" | "gauge";
  labels?: Record<string, string>;
  value: number;
};

export async function buildPromExposition(
  db: Database,
  queues: Queues
): Promise<string> {
  const samples: Sample[] = [];
  const now = new Date();
  const since1h = new Date(now.getTime() - 60 * 60 * 1000);
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  // ── Counters from DB ─────────────────────────────────────────────────
  const [
    msgsSent24h,
    msgsAi24h,
    msgsBroker24h,
    handoffs24h,
    slaAlerts24h,
    appointments24h,
    convsActive,
    convsHandedOff,
    leadsTotal,
    leads24h,
    followupsByStatus
  ] = await Promise.all([
    db.select({ n: count() }).from(schema.messages).where(gte(schema.messages.createdAt, since24h)),
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(eq(schema.messages.senderType, "ai"))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(schema.messages)
      .where(eq(schema.messages.senderType, "broker"))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(schema.conversations)
      .where(eq(schema.conversations.status, "handed_off"))
      .then((r) => r[0]?.n ?? 0),
    db
      .select({ n: count() })
      .from(schema.leadStageAlerts)
      .where(gte(schema.leadStageAlerts.alertedAt, since24h)),
    db
      .select({ n: count() })
      .from(schema.appointments)
      .where(gte(schema.appointments.createdAt, since24h)),
    db
      .select({ n: count() })
      .from(schema.conversations)
      .where(eq(schema.conversations.status, "ai_active")),
    db
      .select({ n: count() })
      .from(schema.conversations)
      .where(eq(schema.conversations.status, "handed_off")),
    db.select({ n: count() }).from(schema.leads),
    db.select({ n: count() }).from(schema.leads).where(gte(schema.leads.createdAt, since24h)),
    db
      .select({ status: schema.leadFollowups.status, n: count() })
      .from(schema.leadFollowups)
      .groupBy(schema.leadFollowups.status)
  ]);

  samples.push(
    sample("counter", "pointer_messages_total_24h", "Messages persisted in last 24h", Number(msgsSent24h[0]?.n ?? 0)),
    sample("counter", "pointer_messages_ai_total", "AI-sent messages", Number(msgsAi24h)),
    sample("counter", "pointer_messages_broker_total", "Broker-sent messages", Number(msgsBroker24h)),
    sample("gauge", "pointer_handoffs_total", "Conversations currently handed off", Number(handoffs24h)),
    sample("counter", "pointer_sla_alerts_24h", "SLA alerts fired in last 24h", Number(slaAlerts24h[0]?.n ?? 0)),
    sample("counter", "pointer_appointments_24h", "Appointments created in last 24h", Number(appointments24h[0]?.n ?? 0)),
    sample("gauge", "pointer_conversations_active", "Conversations with AI active", Number(convsActive[0]?.n ?? 0)),
    sample("gauge", "pointer_conversations_handed_off", "Conversations handed off", Number(convsHandedOff[0]?.n ?? 0)),
    sample("counter", "pointer_leads_total", "Total leads in DB", Number(leadsTotal[0]?.n ?? 0)),
    sample("counter", "pointer_leads_24h", "Leads created in last 24h", Number(leads24h[0]?.n ?? 0))
  );

  for (const r of followupsByStatus) {
    samples.push(
      sample(
        "gauge",
        "pointer_followups_by_status",
        "Lead followups grouped by status",
        Number(r.n),
        { status: r.status }
      )
    );
  }

  // ── BullMQ queue depths ──────────────────────────────────────────────
  const queueNames = Object.keys(queues) as Array<keyof Queues>;
  for (const name of queueNames) {
    const q = queues[name];
    try {
      const counts = await q.getJobCounts("waiting", "active", "delayed", "failed");
      samples.push(
        sample("gauge", "pointer_queue_waiting", "Jobs waiting in queue", counts.waiting ?? 0, { queue: q.name }),
        sample("gauge", "pointer_queue_active", "Jobs currently active", counts.active ?? 0, { queue: q.name }),
        sample("gauge", "pointer_queue_delayed", "Jobs delayed", counts.delayed ?? 0, { queue: q.name }),
        sample("gauge", "pointer_queue_failed", "Jobs failed", counts.failed ?? 0, { queue: q.name })
      );
    } catch {
      // Queue may not be reachable; skip rather than 500 the scrape
    }
  }

  // ── Render exposition format ─────────────────────────────────────────
  return renderExposition(samples);
}

function sample(
  type: Sample["type"],
  name: string,
  help: string,
  value: number,
  labels?: Record<string, string>
): Sample {
  return { type, name, help, value, labels };
}

function renderExposition(samples: Sample[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of samples) {
    if (!seen.has(s.name)) {
      out.push(`# HELP ${s.name} ${s.help}`);
      out.push(`# TYPE ${s.name} ${s.type}`);
      seen.add(s.name);
    }
    const labelStr = s.labels
      ? "{" +
        Object.entries(s.labels)
          .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
          .join(",") +
        "}"
      : "";
    out.push(`${s.name}${labelStr} ${s.value}`);
  }
  return out.join("\n") + "\n";
}

function escapeLabel(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
