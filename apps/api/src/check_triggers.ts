import { createDb } from "@pointer/db";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const apps = await db.query.appointments.findMany();
  console.log('Appointments:', apps.map(a => ({ date: a.scheduledFor, address: a.address })));
  
  const execs = await db.query.toolExecutions.findMany();
  console.log('Tool Executions:', execs.map(e => ({ name: e.toolName, status: e.status })));
  
  const msgs = await db.query.messages.findMany();
  console.log('Messages:', msgs.length, msgs.map(m => `[${m.direction}] ${m.content}`));
  
  process.exit(0);
}

run().catch(console.error);
