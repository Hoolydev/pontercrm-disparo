import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { campaigns } from "./campaigns.js";
import { createdAt } from "./_common.js";
import { whatsappInstances } from "./whatsapp-instances.js";

export const campaignInstances = pgTable(
  "campaign_instances",
  {
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => whatsappInstances.id, { onDelete: "cascade" }),
    createdAt: createdAt()
  },
  (t) => ({
    pk: primaryKey({ columns: [t.campaignId, t.instanceId] })
  })
);

export type CampaignInstanceRow = typeof campaignInstances.$inferSelect;
export type CampaignInstanceInsert = typeof campaignInstances.$inferInsert;
