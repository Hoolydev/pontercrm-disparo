import { schema } from "@pointer/db";
import type { Database } from "@pointer/db";
import { eq } from "drizzle-orm";
import { recordEvent } from "./domain-events.js";

export async function changeLeadStage(
  db: Database,
  leadId: string,
  newStageId: string,
  opts?: { actor?: string | null }
): Promise<{ changed: boolean; previousStageId: string | null }> {
  const lead = await db.query.leads.findFirst({
    where: eq(schema.leads.id, leadId),
    columns: { id: true, pipelineStageId: true }
  });
  if (!lead) {
    throw new Error(`lead not found: ${leadId}`);
  }

  if (lead.pipelineStageId === newStageId) {
    return { changed: false, previousStageId: lead.pipelineStageId };
  }

  await db
    .update(schema.leads)
    .set({ pipelineStageId: newStageId, stageEnteredAt: new Date() })
    .where(eq(schema.leads.id, leadId));

  await recordEvent(db, "lead", leadId, "lead.stage_changed", {
    actor: opts?.actor ?? null,
    payload: {
      previousStageId: lead.pipelineStageId,
      newStageId
    }
  });

  return { changed: true, previousStageId: lead.pipelineStageId };
}
