import { sql } from "drizzle-orm";
import { boolean, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";

export const pipelines = pgTable(
  "pipelines",
  {
    id: id(),
    name: text("name").notNull(),
    description: text("description"),
    isDefault: boolean("is_default").notNull().default(false),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    // Only one row may have is_default=true at any time.
    defaultUq: uniqueIndex("pipelines_default_uq")
      .on(t.isDefault)
      .where(sql`${t.isDefault} = true`)
  })
);

export type PipelineRow = typeof pipelines.$inferSelect;
export type PipelineInsert = typeof pipelines.$inferInsert;
