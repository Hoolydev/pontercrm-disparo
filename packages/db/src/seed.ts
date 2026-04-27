import { randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, count, eq } from "drizzle-orm";
import { Pool } from "pg";
import { hash } from "argon2";
import * as schema from "./schema/index.js";

/**
 * Seed Pointer fixtures. Each block is independently idempotent — running
 * `pnpm db:seed` repeatedly is safe and only creates what's missing. Useful
 * after migrations that add new entities (e.g. when we added a new agent
 * type and the all-or-nothing seed used to skip it).
 *
 * Output reports `created` vs `skipped` per block so you can see which gaps
 * the run filled.
 */
const SYSTEM_PROMPT_INBOUND = `Você é um assistente virtual especializado em imóveis da Pointer Imóveis.

Seu papel é receber mensagens de leads que chegaram via portais (ZAP, VivaReal, OLX, site)
e dar continuidade à conversa: tirar dúvidas, qualificar interesse, agendar visitas e
acionar um corretor humano quando o lead estiver pronto.

Regras de comportamento:
- Cordial, profissional, objetivo
- Português do Brasil, informal mas respeitoso (você, não tu)
- Nunca invente informações sobre imóveis — se não souber, diga que vai verificar
- Se o lead pedir falar com humano, transfira imediatamente
- Mensagens curtas e diretas; emojis com moderação`;

const SYSTEM_PROMPT_OUTBOUND = `Você é um assistente virtual da Pointer Imóveis fazendo a primeira
abordagem com leads recém-captados.

Seu papel é se apresentar de forma natural, gerar interesse no imóvel ou perfil de busca, e
puxar a conversa pra entender melhor a necessidade. Use as informações do lead disponíveis no
contexto (nome, imóvel de interesse, origem do lead) para personalizar a abordagem.

Regras:
- Sempre se apresentar como "Pointer Imóveis"
- Mensagem inicial curta, conversacional, com 1 pergunta aberta
- Português do Brasil, informal mas respeitoso
- Não pareça robô — varie a saudação`;

type BlockResult = "created" | "skipped";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@pointer.com.br";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "pointer-admin-2024!";
  if (adminPassword.length < 12) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 12 characters");
  }

  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool, { schema });
  const summary: Record<string, BlockResult> = {};

  try {
    console.log("[seed] 🌱 Running idempotent seed…");

    // ── 1. Admin user ───────────────────────────────────────────────────
    summary.admin = await ensureAdmin(db, adminEmail, adminPassword);

    // ── 2. Default pipeline + 5 stages ──────────────────────────────────
    summary.pipeline = await ensureDefaultPipeline(db);

    // ── 3. Inbound + Outbound agents ────────────────────────────────────
    summary.inboundAgent = await ensureAgent(db, {
      type: "inbound",
      name: "Atendimento Inbound — Pointer",
      systemPrompt: SYSTEM_PROMPT_INBOUND,
      tools: ["transfer_to_broker", "schedule_visit", "update_stage"],
      delayRange: [800, 2500],
      temperature: 0.7,
      maxTokens: 500
    });
    summary.outboundAgent = await ensureAgent(db, {
      type: "outbound",
      name: "Abordagem Outbound — Pointer",
      systemPrompt: SYSTEM_PROMPT_OUTBOUND,
      tools: ["transfer_to_broker", "schedule_visit", "update_stage"],
      delayRange: [10_000, 18_000],
      temperature: 0.85,
      maxTokens: 350
    });

    // ── 4. Default lead source ──────────────────────────────────────────
    const sourceResult = await ensureLeadSource(db);
    summary.leadSource = sourceResult.result;

    // ── Report ──────────────────────────────────────────────────────────
    console.log("\n[seed] Summary:");
    for (const [k, v] of Object.entries(summary)) {
      const mark = v === "created" ? "✨ created" : "⏭  skipped";
      console.log(`  ${mark}  ${k}`);
    }
    if (sourceResult.result === "created" && sourceResult.webhookSecret) {
      console.log("\n────────────────────────────────────────────────");
      console.log(`  Webhook URL:    POST /webhooks/leads/${sourceResult.id}`);
      console.log(`  Webhook secret: ${sourceResult.webhookSecret}`);
      console.log("────────────────────────────────────────────────");
      console.log("\n⚠️  Save the webhook secret — it won't be shown again.\n");
    }
  } finally {
    await pool.end();
  }
}

// ── Block helpers ───────────────────────────────────────────────────────

async function ensureAdmin(
  db: ReturnType<typeof drizzle<typeof schema>>,
  email: string,
  password: string
): Promise<BlockResult> {
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
    columns: { id: true }
  });
  if (existing) return "skipped";

  const passwordHash = await hash(password);
  await db.insert(schema.users).values({
    id: crypto.randomUUID(),
    email,
    passwordHash,
    role: "admin",
    active: true
  });
  return "created";
}

async function ensureDefaultPipeline(
  db: ReturnType<typeof drizzle<typeof schema>>
): Promise<BlockResult> {
  const existing = await db.query.pipelines.findFirst({
    where: eq(schema.pipelines.isDefault, true),
    columns: { id: true }
  });
  if (existing) return "skipped";

  const pipelineId = crypto.randomUUID();
  await db.insert(schema.pipelines).values({
    id: pipelineId,
    name: "Padrão",
    description: "Pipeline padrão",
    isDefault: true,
    active: true
  });
  await db.insert(schema.pipelineStages).values([
    { id: crypto.randomUUID(), pipelineId, name: "Novo", position: 1, category: "open", color: "#94a3b8" },
    { id: crypto.randomUUID(), pipelineId, name: "Em conversa", position: 2, category: "open", color: "#3b82f6" },
    { id: crypto.randomUUID(), pipelineId, name: "Qualificado", position: 3, category: "open", color: "#8b5cf6" },
    { id: crypto.randomUUID(), pipelineId, name: "Ganho", position: 4, category: "won", color: "#22c55e" },
    { id: crypto.randomUUID(), pipelineId, name: "Perdido", position: 5, category: "lost", color: "#ef4444" }
  ]);
  return "created";
}

async function ensureAgent(
  db: ReturnType<typeof drizzle<typeof schema>>,
  spec: {
    type: "inbound" | "outbound";
    name: string;
    systemPrompt: string;
    tools: string[];
    delayRange: [number, number];
    temperature: number;
    maxTokens: number;
  }
): Promise<BlockResult> {
  const existing = await db
    .select({ n: count() })
    .from(schema.agents)
    .where(and(eq(schema.agents.type, spec.type), eq(schema.agents.active, true)));
  if (Number(existing[0]?.n ?? 0) > 0) return "skipped";

  await db.insert(schema.agents).values({
    id: crypto.randomUUID(),
    name: spec.name,
    type: spec.type,
    model: "gpt-4o-mini",
    systemPrompt: spec.systemPrompt,
    behaviorJson: {
      temperature: spec.temperature,
      max_tokens: spec.maxTokens,
      max_history_messages: spec.type === "inbound" ? 20 : 10,
      delay_range_ms: spec.delayRange,
      summarize_after_messages: 30,
      tools_enabled: spec.tools
    },
    active: true
  });
  return "created";
}

async function ensureLeadSource(
  db: ReturnType<typeof drizzle<typeof schema>>
): Promise<{ result: BlockResult; id?: string; webhookSecret?: string }> {
  const existing = await db.query.leadSources.findFirst({
    where: eq(schema.leadSources.name, "Site Pointer"),
    columns: { id: true }
  });
  if (existing) return { result: "skipped" };

  const id = crypto.randomUUID();
  const webhookSecret = randomBytes(32).toString("hex");
  await db.insert(schema.leadSources).values({
    id,
    type: "website",
    name: "Site Pointer",
    webhookSecret,
    active: true,
    configJson: {}
  });
  return { result: "created", id, webhookSecret };
}

main().catch((err) => {
  console.error("[seed] ❌ Failed:", err);
  process.exit(1);
});
