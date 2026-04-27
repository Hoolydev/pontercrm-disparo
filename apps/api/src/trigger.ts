import { createDb, schema } from "@pointer/db";
import { getQueues } from "@pointer/queue";
import { eq } from "drizzle-orm";

const DATABASE_URL = process.env.DATABASE_URL!;
const db = createDb(DATABASE_URL);

async function run() {
  const campaign = await db.query.campaigns.findFirst();
  if (campaign) {
    console.log("Dispatching seeder for campaign:", campaign.id);
    const queues = getQueues();
    await queues.outboundBlastSeeder.add(
      `seed:${campaign.id}`,
      { campaignId: campaign.id },
      { removeOnComplete: true }
    );
    console.log("Enqueued.");
  }
  
  process.exit(0);
}

run().catch(console.error);
