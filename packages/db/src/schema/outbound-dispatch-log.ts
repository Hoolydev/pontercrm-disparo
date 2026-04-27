import { index, integer, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { createdAt, id } from "./_common.js";
import { messages } from "./messages.js";
import { whatsappInstances } from "./whatsapp-instances.js";

export const outboundDispatchLog = pgTable(
  "outbound_dispatch_log",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id").references(() => whatsappInstances.id, {
      onDelete: "set null"
    }),
    campaignId: uuid("campaign_id").references(() => campaigns.id, { onDelete: "set null" }),
    jobId: text("job_id"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: createdAt()
  },
  (t) => ({
    messageIdx: index("outbound_dispatch_log_message_idx").on(t.messageId),
    campaignIdx: index("outbound_dispatch_log_campaign_idx").on(t.campaignId)
  })
);

export type OutboundDispatchLogRow = typeof outboundDispatchLog.$inferSelect;
export type OutboundDispatchLogInsert = typeof outboundDispatchLog.$inferInsert;
