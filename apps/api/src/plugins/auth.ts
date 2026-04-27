import type { Role } from "@pointer/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; role: Role };
    user: { sub: string; role: Role };
  }
}

export async function registerAuth(app: FastifyInstance) {
  app.decorate(
    "authenticate",
    async function (req: FastifyRequest, reply: FastifyReply) {
      try {
        await req.jwtVerify();
      } catch {
        return reply.unauthorized();
      }
    }
  );

  app.decorate("requireRole", function (...roles: Role[]) {
    return async function (req: FastifyRequest, reply: FastifyReply) {
      if (!req.user) return reply.unauthorized();
      if (!roles.includes(req.user.role)) return reply.forbidden();
    };
  });
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (
      ...roles: Role[]
    ) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
