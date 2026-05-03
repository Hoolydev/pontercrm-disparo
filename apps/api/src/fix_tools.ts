import { createDb, schema } from "@pointer/db";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

const ALL_TOOLS = [
  "transfer_to_broker",
  "schedule_visit",
  "update_stage",
  "send_property"
];

async function run() {
  const agents = await db.query.agents.findMany();
  for (const a of agents) {
    const b = a.behaviorJson || {};
    b.tools_enabled = [...ALL_TOOLS];
    await db.update(schema.agents).set({ behaviorJson: b }).where(eq(schema.agents.id, a.id));
    console.log(`✓ ${a.name} (${a.type}) → ${ALL_TOOLS.join(", ")}`);
  }
  console.log(`Fixed tools on ${agents.length} agent(s).`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
