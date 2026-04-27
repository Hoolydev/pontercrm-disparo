import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
  uuid
} from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";
import { users } from "./users.js";

/**
 * Property catalog ("Captação") — imóveis em portfólio. Used by:
 *   - Sales team to maintain the canonical listing
 *   - Agent tool `send_property` to share PDFs / photos with leads
 *   - Future: PDF rendering of the property details (photos + description)
 */
export const properties = pgTable(
  "properties",
  {
    id: id(),
    /** Internal short code, unique. ex: "AP-001". Auto-generated if omitted. */
    code: text("code"),
    title: text("title").notNull(),
    description: text("description"),
    /** 'apartment' | 'house' | 'commercial' | 'land' | other free-form */
    kind: text("kind").notNull().default("apartment"),
    /** Sale or rental — affects which BusinessType filter applies. */
    transactionType: text("transaction_type").notNull().default("sale"), // 'sale' | 'rent'
    /** Price in cents (BRL). Null for "consulte" / on-request. */
    priceCents: integer("price_cents"),
    /** Condominium fee monthly, in cents. */
    condoFeeCents: integer("condo_fee_cents"),
    /** Annual IPTU in cents. */
    iptuCents: integer("iptu_cents"),
    bedrooms: integer("bedrooms"),
    bathrooms: integer("bathrooms"),
    parkingSpots: integer("parking_spots"),
    areaSqm: integer("area_sqm"),
    /** Free-form features — pet-friendly, gym, churrasqueira, etc. */
    featuresJson: jsonb("features_json").$type<string[]>().notNull().default([]),
    addressJson: jsonb("address_json").$type<{
      street?: string;
      number?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      zip?: string;
    }>().notNull().default({}),
    /**
     * Photo URLs (ordered). For now, externally hosted (uploaded blob storage
     * to be added). Same as agent attachments — Phase 2.
     */
    photosJson: jsonb("photos_json").$type<Array<{ url: string; caption?: string }>>().notNull().default([]),
    /** External listing reference (ZAP/OLX/portal id) for traceability. */
    externalRef: text("external_ref"),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    codeUq: uniqueIndex("properties_code_uq")
      .on(t.code)
      .where(sql`${t.code} IS NOT NULL`),
    activeIdx: index("properties_active_idx").on(t.active),
    transactionIdx: index("properties_transaction_idx").on(t.transactionType)
  })
);

export type PropertyRow = typeof properties.$inferSelect;
export type PropertyInsert = typeof properties.$inferInsert;
