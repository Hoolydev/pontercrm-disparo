import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { count, eq, sql } from "drizzle-orm";

/**
 * Weighted round-robin: pick the broker with the lowest ratio of
 * (active_conversations / round_robin_weight). Ties broken by broker id.
 * Returns null if no active brokers exist.
 */
export async function pickBroker(db: Database): Promise<string | null> {
  const rows = await db
    .select({
      brokerId: schema.brokers.id,
      weight: schema.brokers.roundRobinWeight,
      active_convs: count(schema.conversations.id)
    })
    .from(schema.brokers)
    .leftJoin(
      schema.conversations,
      sql`${schema.conversations.assignedBrokerId} = ${schema.brokers.id}
          AND ${schema.conversations.status} != ${"closed"}`
    )
    .where(eq(schema.brokers.active, true))
    .groupBy(schema.brokers.id, schema.brokers.roundRobinWeight)
    .orderBy(
      sql`(count(${schema.conversations.id})::float / ${schema.brokers.roundRobinWeight}) ASC`,
      schema.brokers.id
    )
    .limit(1);

  return rows[0]?.brokerId ?? null;
}
