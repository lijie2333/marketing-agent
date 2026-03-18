import "dotenv/config";
import { Queue } from "bullmq";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { URL } from "url";

function parseRedisConnection(redisUrl: string) {
  try {
    const u = new URL(redisUrl);
    return {
      host: u.hostname || "localhost",
      port: u.port ? parseInt(u.port) : 6379,
      password: u.password || undefined,
      db: u.pathname && u.pathname.length > 1 ? parseInt(u.pathname.slice(1)) : 0,
    };
  } catch {
    return { host: "localhost", port: 6379 };
  }
}

async function main() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const db = new PrismaClient({ adapter });
  const redisConnection = parseRedisConnection(process.env.REDIS_URL || "redis://localhost:6379");

  // Find a merchant and a strategy to attach the prompt
  const merchant = await db.merchant.findFirst();
  if (!merchant) {
    console.error("No merchant found. Please create one via onboarding first.");
    process.exit(1);
  }

  // Find or create a strategy
  let strategy = await db.videoStrategy.findFirst({
    where: { brandProfile: { merchantId: merchant.id } },
  });

  if (!strategy) {
    const profile = await db.brandProfile.findFirst({ where: { merchantId: merchant.id } });
    if (!profile) {
      console.error("No brand profile found. Please create one via onboarding first.");
      process.exit(1);
    }
    strategy = await db.videoStrategy.create({
      data: {
        brandProfileId: profile.id,
        contentMatrix: {},
        keywordPool: {},
      },
    });
  }

  const content = "一位年轻女性在阳光明媚的咖啡馆里，优雅地品尝一杯拿铁咖啡，温暖的光线透过玻璃窗洒在她的脸上，画面清新自然，充满生活气息。";

  // Create prompt + video job
  const prompt = await db.prompt.create({
    data: {
      strategyId: strategy.id,
      content,
      duration: 15,
      ratio: "9:16",
      style: "生活方式",
      direction: "产品展示",
      isConfirmed: true,
      videoJob: {
        create: {
          status: "QUEUED",
        },
      },
    },
    include: { videoJob: true },
  });

  const jobId = prompt.videoJob!.id;
  console.log(`Created test prompt: ${prompt.id}`);
  console.log(`Created test job: ${jobId}`);

  // Add to BullMQ queue
  const queue = new Queue("video-generation", { connection: redisConnection });
  await queue.add("generate", {
    jobId,
    content,
    duration: 15,
    ratio: "9:16",
  }, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });

  console.log("Test job added to queue. Worker should pick it up now.");
  await queue.close();
  await db.$disconnect();
}

main().catch(console.error);
