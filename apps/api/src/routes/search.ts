import { schema } from "@pointer/db";
import { desc, ilike, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { getDb } from "../db.js";

/**
 * Global search — Cmd+K palette.
 *
 * Returns top 5 matches for leads (name/phone/email) and top 5 conversations
 * (joined with lead.name). Pages are static and resolved client-side. Single
 * `q` parameter; min length 2 to avoid trivial matches.
 */
export async function registerSearch(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get<{ Querystring: { q?: string } }>("/search", auth, async (req) => {
    const q = (req.query.q ?? "").trim();
    if (q.length < 2) return { leads: [], conversations: [] };

    const pattern = `%${q}%`;
    const db = getDb();

    const [leads, conversations] = await Promise.all([
      db.query.leads.findMany({
        where: or(
          ilike(schema.leads.name, pattern),
          ilike(schema.leads.phone, pattern),
          ilike(schema.leads.email, pattern)
        ),
        orderBy: [desc(schema.leads.createdAt)],
        limit: 5,
        columns: { id: true, name: true, phone: true, email: true }
      }),
      db.execute<{
        id: string;
        status: string;
        last_message_at: string | null;
        lead_id: string;
        lead_name: string | null;
        lead_phone: string;
      }>(sql`
        SELECT
          c.id, c.status, c.last_message_at, c.lead_id,
          l.name AS lead_name, l.phone AS lead_phone
        FROM ${schema.conversations} c
        JOIN ${schema.leads} l ON l.id = c.lead_id
        WHERE l.name ILIKE ${pattern} OR l.phone ILIKE ${pattern}
        ORDER BY c.last_message_at DESC NULLS LAST
        LIMIT 5
      `)
    ]);

    const convList = Array.isArray(conversations)
      ? (conversations as Array<{
          id: string;
          status: string;
          last_message_at: string | null;
          lead_id: string;
          lead_name: string | null;
          lead_phone: string;
        }>)
      : (conversations as { rows: Array<{ id: string; status: string; last_message_at: string | null; lead_id: string; lead_name: string | null; lead_phone: string }> }).rows;

    return {
      leads: leads.map((l) => ({
        id: l.id,
        name: l.name,
        phone: l.phone,
        email: l.email
      })),
      conversations: convList.map((c) => ({
        id: c.id,
        status: c.status,
        lastMessageAt: c.last_message_at,
        lead: { id: c.lead_id, name: c.lead_name, phone: c.lead_phone }
      }))
    };
  });
}
