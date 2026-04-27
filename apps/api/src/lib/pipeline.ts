import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { and, asc, eq } from "drizzle-orm";

let cachedDefaultStageId: string | null = null;

export async function resolveDefaultStageId(db: Database): Promise<string> {
  if (cachedDefaultStageId) return cachedDefaultStageId;

  const pipeline = await db.query.pipelines.findFirst({
    where: and(eq(schema.pipelines.isDefault, true), eq(schema.pipelines.active, true))
  });
  if (!pipeline) {
    throw new Error(
      "no default pipeline found — run seed or create one with is_default=true"
    );
  }
  const stage = await db.query.pipelineStages.findFirst({
    where: eq(schema.pipelineStages.pipelineId, pipeline.id),
    orderBy: [asc(schema.pipelineStages.position)]
  });
  if (!stage) {
    throw new Error(`default pipeline ${pipeline.id} has no stages`);
  }
  cachedDefaultStageId = stage.id;
  return stage.id;
}

export function clearPipelineCache() {
  cachedDefaultStageId = null;
}
