import { schema } from "@pointer/db";
import type { StageCategory } from "@pointer/shared";
import { newId } from "@pointer/shared";
import { and, asc, count, eq, gte, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { clearPipelineCache } from "../lib/pipeline.js";
import { getDb } from "../db.js";

const pipelineBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional(),
  active: z.boolean().optional()
});

const stageBody = z.object({
  name: z.string().min(1).max(80),
  category: z.enum(["open", "won", "lost"]),
  position: z.number().int().min(1).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  slaHours: z.number().int().min(1).optional()
});

export async function registerPipelines(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const authGuard = { preHandler: [app.authenticate] };

  // ── Pipelines ───────────────────────────────────────────────────────
  app.get("/pipelines", authGuard, async () => {
    const db = getDb();
    const rows = await db.query.pipelines.findMany({
      orderBy: [asc(schema.pipelines.name)],
      with: {
        stages: {
          orderBy: [asc(schema.pipelineStages.position)]
        }
      }
    });
    return { pipelines: rows };
  });

  app.post("/pipelines", adminGuard, async (req, reply) => {
    const body = pipelineBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);
    const db = getDb();
    const id = newId();
    await db.insert(schema.pipelines).values({
      id,
      name: body.data.name,
      description: body.data.description,
      active: body.data.active ?? true,
      isDefault: false
    });
    return reply.code(201).send({ id });
  });

  app.get<{ Params: { id: string } }>("/pipelines/:id", authGuard, async (req, reply) => {
    const db = getDb();
    const row = await db.query.pipelines.findFirst({
      where: eq(schema.pipelines.id, req.params.id),
      with: { stages: { orderBy: [asc(schema.pipelineStages.position)] } }
    });
    if (!row) return reply.notFound();
    return { pipeline: row };
  });

  app.patch<{ Params: { id: string } }>("/pipelines/:id", adminGuard, async (req, reply) => {
    const body = pipelineBody.partial().safeParse(req.body);
    if (!body.success) return reply.badRequest();
    const db = getDb();
    await db
      .update(schema.pipelines)
      .set(body.data)
      .where(eq(schema.pipelines.id, req.params.id));
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/pipelines/:id", adminGuard, async (req, reply) => {
    const db = getDb();
    const pipe = await db.query.pipelines.findFirst({
      where: eq(schema.pipelines.id, req.params.id),
      columns: { id: true, isDefault: true }
    });
    if (!pipe) return reply.notFound();
    if (pipe.isDefault) {
      return reply.badRequest("cannot delete the default pipeline");
    }
    // Block if any leads point to a stage of this pipeline.
    const leadRows = await db
      .select({ n: count() })
      .from(schema.leads)
      .where(
        sql`${schema.leads.pipelineStageId} IN (SELECT id FROM ${schema.pipelineStages} WHERE pipeline_id = ${req.params.id})`
      );
    const leadCount = Number(leadRows[0]?.n ?? 0);
    if (leadCount > 0) {
      return reply.badRequest(`pipeline has ${leadCount} leads — move them out first`);
    }
    await db.delete(schema.pipelines).where(eq(schema.pipelines.id, req.params.id));
    clearPipelineCache();
    return reply.code(204).send();
  });

  app.patch<{ Params: { id: string } }>(
    "/pipelines/:id/set-default",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const pipe = await db.query.pipelines.findFirst({
        where: eq(schema.pipelines.id, req.params.id),
        columns: { id: true }
      });
      if (!pipe) return reply.notFound();

      // Atomic flip via a single UPDATE: the partial unique index allows
      // multiple is_default=false rows + at most one is_default=true row.
      // Sequence: unset all → set one. Inside a transaction.
      await db.transaction(async (tx) => {
        await tx
          .update(schema.pipelines)
          .set({ isDefault: false })
          .where(eq(schema.pipelines.isDefault, true));
        await tx
          .update(schema.pipelines)
          .set({ isDefault: true })
          .where(eq(schema.pipelines.id, req.params.id));
      });
      clearPipelineCache();
      return { ok: true };
    }
  );

  // ── Stages ──────────────────────────────────────────────────────────
  app.post<{ Params: { id: string } }>(
    "/pipelines/:id/stages",
    adminGuard,
    async (req, reply) => {
      const body = stageBody.safeParse(req.body);
      if (!body.success) return reply.badRequest(body.error.message);
      const db = getDb();

      // Auto-position = max(position) + 1 for the pipeline if not provided
      let position = body.data.position;
      if (position === undefined) {
        const [maxRow] = await db
          .select({ max: sql<number>`coalesce(max(${schema.pipelineStages.position}), 0)::int` })
          .from(schema.pipelineStages)
          .where(eq(schema.pipelineStages.pipelineId, req.params.id));
        position = (maxRow?.max ?? 0) + 1;
      }

      const id = newId();
      try {
        await db.insert(schema.pipelineStages).values({
          id,
          pipelineId: req.params.id,
          name: body.data.name,
          position,
          category: body.data.category,
          color: body.data.color,
          slaHours: body.data.slaHours
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("pipeline_stages_pipeline_position_uq")) {
          return reply.conflict(`position ${position} is taken in pipeline ${req.params.id}`);
        }
        throw err;
      }
      return reply.code(201).send({ id });
    }
  );

  app.patch<{ Params: { id: string; stageId: string } }>(
    "/pipelines/:id/stages/:stageId",
    adminGuard,
    async (req, reply) => {
      const body = stageBody
        .pick({ name: true, category: true, color: true, slaHours: true })
        .partial()
        .safeParse(req.body);
      if (!body.success) return reply.badRequest();
      const db = getDb();
      await db
        .update(schema.pipelineStages)
        .set(body.data)
        .where(
          and(
            eq(schema.pipelineStages.id, req.params.stageId),
            eq(schema.pipelineStages.pipelineId, req.params.id)
          )
        );
      return { ok: true };
    }
  );

  /**
   * Move a stage to a new position. Behaviour:
   *   - Shift the affected stages within the same pipeline so that all
   *     positions stay unique. Wrapped in a transaction.
   *   - Two-phase to avoid hitting the (pipeline_id, position) UNIQUE index:
   *     1) park the moving stage at position = -id_hash (negative, never collides)
   *     2) shift the others
   *     3) write the final position
   */
  app.patch<{ Params: { id: string; stageId: string } }>(
    "/pipelines/:id/stages/:stageId/move",
    adminGuard,
    async (req, reply) => {
      const body = z.object({ position: z.number().int().min(1) }).safeParse(req.body);
      if (!body.success) return reply.badRequest();
      const db = getDb();

      const stage = await db.query.pipelineStages.findFirst({
        where: and(
          eq(schema.pipelineStages.id, req.params.stageId),
          eq(schema.pipelineStages.pipelineId, req.params.id)
        )
      });
      if (!stage) return reply.notFound();

      const target = body.data.position;
      if (target === stage.position) return { ok: true, unchanged: true };

      const [maxRow] = await db
        .select({ max: sql<number>`coalesce(max(${schema.pipelineStages.position}), 0)::int` })
        .from(schema.pipelineStages)
        .where(eq(schema.pipelineStages.pipelineId, req.params.id));
      const maxPos = maxRow?.max ?? 0;
      const finalTarget = Math.min(target, maxPos);

      await db.transaction(async (tx) => {
        // Park
        await tx
          .update(schema.pipelineStages)
          .set({ position: -stage.position - 1_000_000 })
          .where(eq(schema.pipelineStages.id, stage.id));

        if (finalTarget > stage.position) {
          // Shift down (positions between old+1 .. new come UP by -1)
          await tx
            .update(schema.pipelineStages)
            .set({ position: sql`${schema.pipelineStages.position} - 1` })
            .where(
              and(
                eq(schema.pipelineStages.pipelineId, req.params.id),
                gte(schema.pipelineStages.position, stage.position + 1),
                sql`${schema.pipelineStages.position} <= ${finalTarget}`
              )
            );
        } else {
          // Shift up (positions between new .. old-1 go DOWN by +1)
          await tx
            .update(schema.pipelineStages)
            .set({ position: sql`${schema.pipelineStages.position} + 1` })
            .where(
              and(
                eq(schema.pipelineStages.pipelineId, req.params.id),
                gte(schema.pipelineStages.position, finalTarget),
                sql`${schema.pipelineStages.position} <= ${stage.position - 1}`
              )
            );
        }

        // Final write
        await tx
          .update(schema.pipelineStages)
          .set({ position: finalTarget })
          .where(eq(schema.pipelineStages.id, stage.id));
      });

      return { ok: true, position: finalTarget };
    }
  );

  app.delete<{ Params: { id: string; stageId: string } }>(
    "/pipelines/:id/stages/:stageId",
    adminGuard,
    async (req, reply) => {
      const db = getDb();
      const stageRows = await db
        .select({ n: count() })
        .from(schema.leads)
        .where(eq(schema.leads.pipelineStageId, req.params.stageId));
      const leadsAtStage = Number(stageRows[0]?.n ?? 0);
      if (leadsAtStage > 0) {
        return reply.badRequest(
          `stage has ${leadsAtStage} leads — move them to another stage first`
        );
      }
      await db
        .delete(schema.pipelineStages)
        .where(
          and(
            eq(schema.pipelineStages.id, req.params.stageId),
            eq(schema.pipelineStages.pipelineId, req.params.id)
          )
        );
      return reply.code(204).send();
    }
  );

  // Read-only listing of stage categories (consistent with shared types).
  app.get("/pipeline-stage-categories", authGuard, async () => {
    const cats: StageCategory[] = ["open", "won", "lost"];
    return { categories: cats };
  });
}
