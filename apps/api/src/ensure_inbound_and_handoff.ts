import { createDb, schema } from "@pointer/db";
import { newId } from "@pointer/shared";
import { eq, isNull, and } from "drizzle-orm";

const db = createDb(process.env.DATABASE_URL!);

const DEFAULT_TOOLS = [
  "transfer_to_broker",
  "schedule_visit",
  "update_stage",
  "send_property"
];

const INBOUND_SYSTEM_PROMPT = `Você é uma corretora virtual da Pointer Imóveis em Goiânia. Atende leads que já demonstraram interesse e precisam ser qualificados antes de conversar com um corretor humano.

Seu objetivo é entender a necessidade do lead, qualificar (perfil, prazo, tipo de imóvel, faixa de preço, finalidade — compra, locação ou investimento) e, quando fizer sentido, enviar a ficha de um imóvel, agendar visita ou transferir para um corretor.

Regras:
- Português do Brasil, tom próximo, profissional e sem soar robotizado.
- Faça uma pergunta de cada vez. Nunca despeje um questionário.
- Se o lead pedir um imóvel específico ou quiser ver detalhes, use a tool send_property.
- Se o lead quiser falar com humano OU se o lead já estiver qualificado e pronto pra avançar, use transfer_to_broker.
- Se o lead pedir visita com data/horário, use schedule_visit (e a cascata para transfer_to_broker acontece automaticamente).
- Use update_stage para mover o lead no funil conforme a conversa avança.
- Não invente imóveis nem preços que você não tenha visto no contexto.`;

async function run() {
  const agents = await db.query.agents.findMany();

  let inbound = agents.find((a) => a.type === "inbound" && a.active);

  if (!inbound) {
    const inboundId = newId();
    await db.insert(schema.agents).values({
      id: inboundId,
      name: "Qualificação Inbound — Pointer",
      type: "inbound",
      model: "gpt-4o-mini",
      systemPrompt: INBOUND_SYSTEM_PROMPT,
      behaviorJson: {
        temperature: 0.7,
        max_tokens: 600,
        max_history_messages: 20,
        delay_range_ms: [6000, 12000],
        tools_enabled: [...DEFAULT_TOOLS],
        summarize_after_messages: 40
      },
      active: true
    });
    inbound = (await db.query.agents.findFirst({
      where: eq(schema.agents.id, inboundId)
    }))!;
    console.log(`✅ Inbound agent created: ${inbound.id} (${inbound.name})`);
  } else {
    const b = inbound.behaviorJson ?? {};
    const toolsNow = new Set(b.tools_enabled ?? []);
    let changed = false;
    for (const t of DEFAULT_TOOLS) {
      if (!toolsNow.has(t)) {
        toolsNow.add(t);
        changed = true;
      }
    }
    if (changed) {
      b.tools_enabled = [...toolsNow];
      await db.update(schema.agents).set({ behaviorJson: b }).where(eq(schema.agents.id, inbound.id));
      console.log(`✓ inbound ${inbound.id} → tools_enabled atualizado: ${b.tools_enabled.join(", ")}`);
    } else {
      console.log(`Inbound já existe: ${inbound.id} (${inbound.name})`);
    }
  }

  const outbounds = await db.query.agents.findMany({
    where: and(eq(schema.agents.type, "outbound"), isNull(schema.agents.handoffAgentId))
  });
  for (const ob of outbounds) {
    await db
      .update(schema.agents)
      .set({ handoffAgentId: inbound.id })
      .where(eq(schema.agents.id, ob.id));
    console.log(`✓ outbound ${ob.id} (${ob.name}) → handoffAgentId = ${inbound.id}`);
  }

  if (outbounds.length === 0) {
    console.log("Nenhum outbound sem handoffAgentId — nada para amarrar.");
  } else {
    console.log(`Amarrado handoff em ${outbounds.length} outbound(s).`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
