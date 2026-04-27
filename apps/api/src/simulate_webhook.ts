import { createDb } from "@pointer/db";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const instance = await db.query.whatsappInstances.findFirst();
  const leads = await db.query.campaignLeads.findMany();
  const conv = await db.query.conversations.findFirst({
    with: { lead: true }
  });

  if (!instance || !conv || !conv.lead) {
    console.error("Missing data");
    process.exit(1);
  }
  
  const lead = conv.lead;

  console.log("Simulating webhook for instance:", instance.id, "and lead:", lead.phone);

  const payload = {
    event: "message",
    instance: instance.externalId,
    data: {
      remoteJid: `${lead.phone.replace("+", "")}@s.whatsapp.net`,
      id: "fake-msg-" + Date.now(),
      text: "Olá! Recebi sua mensagem.",
      timestamp: Date.now()
    }
  };

  const res = await fetch(`http://localhost:3333/webhooks/whatsapp/uazapi/${instance.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  console.log("Webhook 1 status:", res.status);
  
  // Wait a few seconds to let AI reply
  await new Promise(r => setTimeout(r, 8000));
  
  // Send "quero visitar amanhã as 10h"
  const payload2 = {
    event: "message",
    instance: instance.externalId,
    data: {
      remoteJid: `${lead.phone.replace("+", "")}@s.whatsapp.net`,
      id: "fake-msg-" + Date.now(),
      text: "quero visitar amanhã as 10h",
      timestamp: Date.now()
    }
  };

  const res2 = await fetch(`http://localhost:3333/webhooks/whatsapp/uazapi/${instance.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload2)
  });

  console.log("Webhook 2 status:", res2.status);
  // Send "quero visitar o Apartamento Vila Mariana amanhã as 10h"
  const payload3 = {
    event: "message",
    instance: instance.externalId,
    data: {
      remoteJid: `${lead.phone.replace("+", "")}@s.whatsapp.net`,
      id: "fake-msg-" + Date.now(),
      text: "quero visitar o Apartamento Vila Mariana amanhã às 10h",
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
