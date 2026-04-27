import { createDb, schema } from "@pointer/db";
import { eq, count } from "drizzle-orm";
import { newId } from "@pointer/shared";

const db = createDb(process.env.DATABASE_URL!);

async function run() {
  const agents = await db.query.agents.findMany();
  console.log("Existing agents:", agents.map(a => ({ id: a.id, name: a.name, type: a.type })));

  const hasOutbound = agents.some(a => a.type === "outbound");
  if (hasOutbound) {
    console.log("Outbound agent already exists — skipping.");
    process.exit(0);
  }

  const outboundId = newId();
  await db.insert(schema.agents).values({
    id: outboundId,
    name: "Abordagem Outbound — Pointer",
    type: "outbound",
    model: "gpt-4o-mini",
    systemPrompt: `Você é um assistente virtual da Pointer Imóveis fazendo a primeira abordagem com leads recém-captados.

Seu papel é se apresentar de forma natural, gerar interesse no imóvel ou perfil de busca, e
puxar a conversa pra entender melhor a necessidade. Use as informações do lead disponíveis no
contexto (nome, imóvel de interesse, origem do lead) para personalizar a abordagem.

Regras:
- Sempre se apresentar como "Pointer Imóveis"
- Mensagem inicial curta, conversacional, com 1 pergunta aberta
- Português do Brasil, informal mas respeitoso
- Não pareça robô — varie a saudação`,
    behaviorJson: {
      temperature: 0.85,
      max_tokens: 350,
      max_history_messages: 10,
      delay_range_ms: [10000, 18000],
      tools_enabled: ["transfer_to_broker", "schedule_visit", "update_stage"]
    },
    active: true
  });

  console.log(`✅ Outbound agent created: ${outboundId}`);
  process.exit(0);
}

run().catch(console.error);
