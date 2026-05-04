import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import type { DomainAggregateType, DomainEventType } from "@pointer/shared";

export interface RecordEventOpts {
  actor?: string | null;
  payload?: Record<string, unknown>;
}

export async function recordEvent(
  db: Database,
  aggregateType: DomainAggregateType,
  aggregateId: string,
  eventType: DomainEventType,
  opts: RecordEventOpts = {}
): Promise<void> {
  await db.insert(schema.domainEvents).values({
    aggregateType,
    aggregateId,
    eventType,
    payloadJson: opts.payload ?? {},
    actor: opts.actor ?? null
  });
}
