/**
 * Throwaway bisection script (Part: pipeline countdown fix debugging,
 * 2026-09-04) -- backfill-wait-timers.ts hangs indefinitely with zero
 * writes and zero CPU once it reaches its first real write, in a way dry-run
 * never reproduces. Isolates each suspect call with its own timestamped log
 * so it's obvious from the output alone which one never returns.
 */
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";
import IORedis from "ioredis";

function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("start");

  log("connecting redis...");
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", { maxRetriesPerRequest: null });
  connection.on("connect", () => log("ioredis: connect event"));
  connection.on("ready", () => log("ioredis: ready event"));
  connection.on("error", (e) => log(`ioredis: error event: ${e.message}`));
  await new Promise((resolve) => setTimeout(resolve, 500));
  log(`ioredis status after 500ms: ${connection.status}`);

  log("creating bullmq queue...");
  const waitQueue = new Queue("wait-timers", { connection });
  log("queue created");

  log("adding a test job...");
  const job = await waitQueue.add("advance-test", { test: true }, { delay: 3600000, jobId: `isolate-hang-test:${Date.now()}` });
  log(`job added: ${job.id}`);

  log("removing the test job...");
  await job.remove();
  log("test job removed");

  log("connecting prisma...");
  const prisma = new PrismaClient();
  log("prisma client constructed");

  log("running a trivial prisma query...");
  const count = await prisma.pipelineState.count();
  log(`prisma query returned: ${count}`);

  log("closing connections...");
  await prisma.$disconnect();
  await connection.quit();
  log("done");
}

main().catch((err) => {
  log(`ERROR: ${err?.stack || err}`);
  process.exit(1);
});
