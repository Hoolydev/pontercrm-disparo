import { createDb } from "./index";
import { schema } from "./index";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const leads = await db.query.campaignLeads.findMany();
  const states = leads.map(l => l.state).reduce((acc, state) => {
    acc[state] = (acc[state] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log("Campaign Leads States:", states);
  
  const appointments = await db.query.appointments.findMany();
  console.log("Appointments created:", appointments.length);
  
  const bq = await db.query.brokerQueue.findMany();
  console.log("Broker Queue:", bq.map(b => ({ status: b.status, attempts: b.attempts })));
  
  const evts = await db.query.webhookEvents.findMany();
  console.log("Webhook Events:", evts.length, evts.map(e => e.provider));
  
  const msgs = await db.query.messages.findMany();
  console.log("Messages:", msgs.length, msgs.map(m => `[${m.direction}] ${m.content}`));
  
  const convs = await db.query.conversations.findMany();
  console.log("Conversations:", convs.length);
  
  process.exit(0);
}

run().catch(console.error);
