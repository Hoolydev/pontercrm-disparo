import { getQueues } from "@pointer/queue";

async function run() {
  const queues = getQueues();
  const failedAiReply = await queues.aiReply.getFailed();
  console.log(`Found ${failedAiReply.length} failed aiReply jobs. Retrying...`);
  
  for (const job of failedAiReply) {
    await job.retry();
    console.log(`Retried job ${job.id}`);
  }
  
  process.exit(0);
}

run().catch(console.error);
