import { createDb } from "@pointer/db";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const instance = await db.query.whatsappInstances.findFirst();
  const convs = await db.query.conversations.findMany({
    with: { lead: true }
  });

  const conv = convs[1]; // Use a different conversation
  if (!instance || !conv || !conv.lead) {
    console.error("Missing data");
    process.exit(1);
  }
  
  const lead = conv.lead;

  const payload3 = {
    event: "message",
    instance: instance.externalId,
    data: {
      remoteJid: `${lead.phone.replace("+", "")}@s.whatsapp.net`,
      id: "fake-msg-" + Date.now(),
      text: "Sim, quero visitar o Apartamento Vila Mariana dia 30 as 10h",
      timestamp: Date.now()
    }
  };

  const res3 = await fetch(`http://localhost:3333/webhooks/whatsapp/uazapi/${instance.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload3)
  });

  console.log("Webhook 3 status:", res3.status);
  process.exit(0);
}

run().catch(console.error);
