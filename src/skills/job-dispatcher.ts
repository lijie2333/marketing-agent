import { db } from "@/lib/db";
import { videoQueue } from "@/lib/queue";
import { SkillDefinition } from "./registry";
import { SchemaType } from "@google/generative-ai";

export const jobDispatcherSkill: SkillDefinition = {
  name: "job-dispatcher",
  description: "Dispatch confirmed prompts to the video generation queue.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      strategyId: { type: SchemaType.STRING, description: "Strategy ID to dispatch all confirmed prompts for" },
      merchantId: { type: SchemaType.STRING, description: "Merchant ID used to scope prompt ownership" },
    },
    required: ["strategyId", "merchantId"],
  },
  handler: async (params) => {
    const prompts = await db.prompt.findMany({
      where: {
        strategyId: params.strategyId as string,
        isConfirmed: true,
        complianceStatus: "APPROVED",
        videoJob: null,
        strategy: { brandProfile: { merchantId: params.merchantId as string } },
      },
    });

    const jobs = await Promise.all(
      prompts.map(async (p) => {
        const job = await db.videoJob.create({
          data: { promptId: p.id, status: "QUEUED" },
        });

        try {
          await videoQueue.add("generate-video", {
            jobId: job.id,
            promptId: p.id,
            content: p.content,
            duration: p.duration,
            ratio: p.ratio,
            referenceImageUrls: p.referenceImageUrls,
          });
          return job.id;
        } catch (error) {
          await db.videoJob.deleteMany({
            where: { id: job.id, status: "QUEUED" },
          });
          throw error;
        }
      })
    );

    return { dispatched: jobs.length, jobIds: jobs };
  },
};
