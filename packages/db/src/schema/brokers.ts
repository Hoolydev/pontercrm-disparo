import { boolean, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";
import { users } from "./users.js";

export const brokers = pgTable(
  "brokers",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    phone: text("phone"),
    creci: text("creci"),
    active: boolean("active").notNull().default(true),
    roundRobinWeight: integer("round_robin_weight").notNull().default(1),
    /** Max simultaneous open leads. Null = unlimited. */
    maxActiveLeads: integer("max_active_leads"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    userIdUq: uniqueIndex("brokers_user_id_uq").on(t.userId)
  })
);

export type BrokerRow = typeof brokers.$inferSelect;
export type BrokerInsert = typeof brokers.$inferInsert;
