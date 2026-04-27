import { createDb, schema } from "@pointer/db";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const agents = await db.query.agents.findMany();
  for (const a of agents) {
    const b = a.behaviorJson || {};
    b.tools_enabled = ['transfer_to_broker', 'schedule_visit', 'update_stage'];
    await db.update(schema.agents).set({ behaviorJson: b }).where(eq(schema.agents.id, a.id));
  }
  console.log('Fixed tools');
  process.exit(0);
}

run().catch(console.error);
