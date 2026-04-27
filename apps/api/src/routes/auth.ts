import { schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { hash, verify } from "argon2";
import { z } from "zod";
import { getDb } from "../db.js";

const loginBody = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

export async function registerAuth(app: FastifyInstance) {
  app.post("/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return reply.badRequest("invalid body");

    const { email, password } = parsed.data;
    const db = getDb();
    const user = await db.query.users.findFirst({ where: eq(schema.users.email, email) });

    if (!user || !user.active) return reply.unauthorized("invalid credentials");

    const ok = await verify(user.passwordHash, password);
    if (!ok) return reply.unauthorized("invalid credentials");

    const token = app.jwt.sign({ sub: user.id, role: user.role }, { expiresIn: "7d" });

    return reply
      .setCookie("pointer_session", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 3600
      })
      .send({ ok: true, token, role: user.role });
  });

  app.post("/auth/logout", async (_req, reply) => {
    return reply.clearCookie("pointer_session", { path: "/" }).send({ ok: true });
  });

  app.get(
    "/auth/me",
    { preHandler: [app.authenticate] },
    async (req) => {
      const db = getDb();
      const user = await db.query.users.findFirst({
        where: eq(schema.users.id, req.user.sub),
        columns: { passwordHash: false }
      });
      if (!user) throw new Error("user not found");
      return { user };
    }
  );

  // Utility: seed first admin (only works when users table is empty)
  app.post("/auth/setup", async (req, reply) => {
    const body = z
      .object({ email: z.string().email(), password: z.string().min(12) })
      .safeParse(req.body);
    if (!body.success) return reply.badRequest();

    const db = getDb();
    const [row] = await db.select({ n: count() }).from(schema.users);
    if ((row?.n ?? 0) > 0) return reply.forbidden("already setup");

    await db.insert(schema.users).values({
      id: newId(),
      email: body.data.email,
      passwordHash: await hash(body.data.password),
      role: "admin"
    });
    return { ok: true };
  });
}
