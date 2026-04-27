import { encryptJson, newId } from "@pointer/shared";
import { eq } from "drizzle-orm";
import { schema, createDb } from "./index";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "12345678901234567890123456789012";
const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  console.log("Setting up validation data...");

  // 1.1 Connect instance
  const instanceId = newId();
  await db.insert(schema.whatsappInstances).values({
    id: instanceId,
    provider: "uazapi",
    number: "556282683262",
    externalId: "556282683262",
    status: "connected",
    active: true,
    rateLimitPerMinute: 20,
    configJson: encryptJson({
      baseUrl: "https://pointerimoveis.uazapi.com",
      token: "1aa7d90b-013c-4b5e-9711-15008092efd2"
    }, ENCRYPTION_KEY)
  }).onConflictDoNothing();
  console.log("Instance created/verified.");

  // 1.2 Verify agents
  const dbAgents = await db.query.agents.findMany();
  console.log(`Found ${dbAgents.length} agents:`, dbAgents.map(a => a.name));
  const inboundAgent = dbAgents.find(a => a.type === "inbound") || dbAgents[0];
  const outboundAgent = dbAgents.find(a => a.type === "outbound") || dbAgents[1];

  // 1.3 Verify pipeline
  const pipeline = await db.query.pipelines.findFirst({ where: eq(schema.pipelines.isDefault, true), with: { stages: true } });
  console.log("Pipeline:", pipeline?.name, "Stages:", pipeline?.stages.length);

  // 1.4 Create brokers
  const brokerRole = "broker";
  const b1Id = newId();
  const b2Id = newId();
  const b3Id = newId();
  
  await db.insert(schema.users).values([
    { id: b1Id, email: "b1@test.com", passwordHash: "x", displayName: "Broker 1", role: "broker", maxActiveLeads: 3 },
    { id: b2Id, email: "b2@test.com", passwordHash: "x", displayName: "Broker 2", role: "broker", maxActiveLeads: 3 },
    { id: b3Id, email: "b3@test.com", passwordHash: "x", displayName: "Broker 3", role: "broker", maxActiveLeads: 10 }
  ]).onConflictDoNothing();
  console.log("Brokers created.");

  // 1.5 Create campaign
  const campaignId = newId();
  await db.insert(schema.campaigns).values({
    id: campaignId,
    name: "Campanha de Validação",
    status: "draft",
    outboundAgentId: outboundAgent?.id,
    inboundAgentId: inboundAgent?.id,
    pipelineId: pipeline?.id,
    settings: {
      max_messages_per_minute: 10,
      distribution: { type: "round-robin", agents: [] },
      instanceIds: [instanceId]
    }
  }).onConflictDoNothing();
  console.log("Campaign created.");

  // Add 20 leads
  const sourceId = (await db.query.leadSources.findFirst())?.id;
  const leadIds = [];
  for (let i = 0; i < 20; i++) {
    const leadId = newId();
    leadIds.push(leadId);
    await db.insert(schema.leads).values({
      id: leadId,
      phone: `+551199999${i.toString().padStart(4, '0')}`,
      name: `Lead Validação ${i}`,
      sourceId,
      pipelineStageId: pipeline?.stages[0]?.id
    });
    await db.insert(schema.campaignLeads).values({
      id: newId(),
      campaignId,
      leadId,
      state: "pending",
      data: {}
    });
  }
  console.log("20 leads added to campaign.");

  // Start campaign
  await db.update(schema.campaigns).set({ status: "active" }).where(eq(schema.campaigns.id, campaignId));
  console.log("Campaign started.");
  
  console.log("Done.");
  process.exit(0);
}

run().catch(console.error);
