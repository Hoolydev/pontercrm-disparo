/**
 * diag_webhooks.ts — diagnóstico de webhooks recebidos
 * Uso: npx tsx src/diag_webhooks.ts
 *
 * Mostra os últimos 20 webhook_events gravados, separando:
 *   - mensagens reais processadas (wa:...)
 *   - payloads ignorados (wa-ignored:...)
 *   - leads vindos de portais (lead-source:...)
 */
import { schema } from "@pointer/db";
import { desc } from "drizzle-orm";
import { getDb } from "./db.js";

const db = getDb();

const events = await db.query.webhookEvents.findMany({
  orderBy: [desc(schema.webhookEvents.createdAt)],
  limit: 20
});

if (events.length === 0) {
  console.log("❌ Nenhum webhook_event encontrado no banco.");
  console.log("   → Isso significa que os webhooks NÃO estão chegando na API.");
  console.log("   → Verifique: URL do webhook no painel Meta, e se a API está rodando no Railway.");
  process.exit(0);
}

console.log(`\n✅ Últimos ${events.length} eventos gravados:\n`);

for (const ev of events) {
  const isIgnored = ev.dedupeKey.startsWith("wa-ignored:");
  const isWA = ev.dedupeKey.startsWith("wa:");
  const isLead = ev.dedupeKey.startsWith("lead:");

  const icon = isIgnored ? "⚠️  IGNORADO" : isWA ? "📨 MENSAGEM" : isLead ? "👤 LEAD" : "❓";
  console.log(`${icon} | ${ev.provider.padEnd(30)} | ${ev.createdAt?.toISOString()}`);
  console.log(`   dedupeKey: ${ev.dedupeKey}`);

  if (isIgnored) {
    const sample = JSON.stringify(ev.rawPayload).slice(0, 400);
    console.log(`   payload  : ${sample}`);
    console.log();
  }
}

console.log("\n─── Resumo ───");
const ignored = events.filter(e => e.dedupeKey.startsWith("wa-ignored:")).length;
const msgs = events.filter(e => e.dedupeKey.startsWith("wa:")).length;
console.log(`  Mensagens WA processadas : ${msgs}`);
console.log(`  Payloads WA ignorados    : ${ignored}`);
console.log(`  Leads de portais         : ${events.filter(e => e.dedupeKey.startsWith("lead:")).length}`);

if (ignored > 0) {
  console.log("\n⚠️  Payloads ignorados encontrados!");
  console.log("   Causa mais comum: payload da Meta não tem 'object: whatsapp_business_account'");
  console.log("   Ou: o campo 'entry[0].changes[0].value.messages' está ausente/vazio");
}
if (msgs === 0 && ignored === 0) {
  console.log("\n❌ Nenhum webhook WhatsApp recebido.");
  console.log("   → Verifique a URL configurada no Meta Business Manager");
  console.log("   → URL correta: https://<sua-api>/webhooks/whatsapp/meta/<instanceId>");
}
