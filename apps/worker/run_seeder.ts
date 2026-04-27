import { createDb } from "@pointer/db";
import { processOutboundBlastSeeder } from "./src/jobs/outbound-blast-seeder";
import pino from "pino";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);
const logger = pino();

async function run() {
  const campaign = await db.query.campaigns.findFirst();
  if (campaign) {
    console.log("Running seeder for campaign:", campaign.id);
    await processOutboundBlastSeeder({ campaignId: campaign.id }, db, logger);
    console.log("Seeder done.");
  }
  process.exit(0);
}

run().catch(console.error);
