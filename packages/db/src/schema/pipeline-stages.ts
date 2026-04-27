import type { StageCategory } from "@pointer/shared";
import { index, integer, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";
import { pipelines } from "./pipelines.js";

export const pipelineStages = pgTable(
  "pipeline_stages",
  {
    id: id(),
    pipelineId: uuid("pipeline_id")
      .notNull()
      .references(() => pipelines.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    category: text("category").$type<StageCategory>().notNull(),
    color: text("color"),
    slaHours: integer("sla_hours"),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    pipelinePositionUq: uniqueIndex("pipeline_stages_pipeline_position_uq").on(
      t.pipelineId,
      t.position
    ),
    pipelineIdx: index("pipeline_stages_pipeline_idx").on(t.pipelineId),
    categoryIdx: index("pipeline_stages_category_idx").on(t.category)
  })
);

export type PipelineStageRow = typeof pipelineStages.$inferSelect;
export type PipelineStageInsert = typeof pipelineStages.$inferInsert;
