import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hash } from "argon2";
import { z } from "zod";
import { getDb } from "../db.js";

const userBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["admin", "supervisor", "broker"]),
  displayName: z.string().min(1).optional(),
  phone: z.string().optional(),
  creci: z.string().optional()
});

export async function registerUsers(app: FastifyInstance) {
  const adminGuard = { preHandler: [app.authenticate, app.requireRole("admin")] };
  const authGuard = { preHandler: [app.authenticate] };

  app.get("/users", adminGuard, async () => {
    const db = getDb();
    const users = await db.query.users.findMany({
      columns: { passwordHash: false },
      with: { broker: { columns: { id: true, displayName: true, active: true, creci: true } } }
    });
    return { users };
  });

  app.post("/users", adminGuard, async (req, reply) => {
    const body = userBody.safeParse(req.body);
    if (!body.success) return reply.badRequest(body.error.message);

    const db = getDb();
    const userId = newId();
    await db.insert(schema.users).values({
      id: userId,
      email: body.data.email,
      passwordHash: await hash(body.data.password),
      role: body.data.role
    });

    if (body.data.role === "broker" && body.data.displayName) {
      await db.insert(schema.brokers).values({
        id: newId(),
        userId,
        displayName: body.data.displayName,
        phone: body.data.phone,
        creci: body.data.creci,
        active: true
      });
    }

    return reply.code(201).send({ id: userId });
  });

  app.patch<{ Params: { id: string } }>("/users/:id/toggle", adminGuard, async (req, reply) => {
    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, req.params.id) });
    if (!user) return reply.notFound();
    await db.update(schema.users).set({ active: !user.active }).where(eq(schema.users.id, user.id));
    return { ok: true, active: !user.active };
  });

  app.patch<{ Params: { id: string } }>(
    "/users/:id/password",
    { preHandler: [app.authenticate] },
    async (req, reply) => {
      const { sub } = req.user;
      // users can only change their own password unless admin
      if (req.user.role !== "admin" && sub !== req.params.id) return reply.forbidden();
      const body = z.object({ password: z.string().min(8) }).safeParse(req.body);
      if (!body.success) return reply.badRequest();
      const db = getDb();
      await db
        .update(schema.users)
        .set({ passwordHash: await hash(body.data.password) })
        .where(eq(schema.users.id, req.params.id));
      return { ok: true };
    }
  );
}
