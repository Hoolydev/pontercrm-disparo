import { createDb, schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const campaign = await db.query.campaigns.findFirst();
  const instance = await db.query.whatsappInstances.findFirst();
  
  if (!campaign || !instance) {
    console.error("Missing campaign or instance");
    process.exit(1);
  }

  const agents = await db.query.agents.findMany();
  const inboundAgent = agents.find(a => a.type === "inbound") || agents[0];
  const outboundAgent = agents.find(a => a.type === "outbound") || agents[0];
  
  if (!inboundAgent || !outboundAgent) {
      console.log("No agents found!");
      process.exit(1);
  }

  // Update settingsJson and agents
  await db.update(schema.campaigns)
    .set({
      settingsJson: { max_messages_per_minute: 20 },
      inboundAgentId: inboundAgent.id,
      outboundAgentId: outboundAgent.id
    })
    .where(eq(schema.campaigns.id, campaign.id));
    
  // Link instance
  await db.insert(schema.campaignInstances)
    .values({ campaignId: campaign.id, instanceId: instance.id })
    .onConflictDoNothing();

  console.log("Fixed campaign settings and instance link.");

  // Dispatch
  const queues = getQueues();
  await queues.outboundBlastSeeder.add(
    `seed:${campaign.id}`,
    { campaignId: campaign.id },
    { removeOnComplete: true }
  );
  console.log("Seeder dispatched.");
  
  // Wait to allow processing
  await new Promise(r => setTimeout(r, 2000));
  
  const leads = await db.query.campaignLeads.findMany({ where: eq(schema.campaignLeads.campaignId, campaign.id) });
  const states = leads.reduce((acc, l) => { acc[l.state] = (acc[l.state] || 0) + 1; return acc; }, {} as Record<string, number>);
  console.log("Leads states:", states);

  process.exit(0);
}

run().catch(console.error);
