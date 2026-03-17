import { Queue } from "bullmq";

const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const url = new URL(redisUrl);

export const redisConnection = {
  host: url.hostname,
  port: parseInt(url.port || "6379"),
  password: url.password || undefined,
  maxRetriesPerRequest: null as null,
};

export const videoQueue = new Queue("video-generation", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 30000 },
  },
});
