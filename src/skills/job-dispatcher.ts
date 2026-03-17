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
    },
    required: ["strategyId"],
  },
  handler: async (params) => {
    const prompts = await db.prompt.findMany({
      where: {
        strategyId: params.strategyId as string,
        isConfirmed: true,
        complianceStatus: "APPROVED",
        videoJob: null,
      },
    });

    const jobs = await Promise.all(
      prompts.map(async (p) => {
        const job = await db.videoJob.create({
          data: { promptId: p.id, status: "QUEUED" },
        });
        await videoQueue.add("generate-video", {
          jobId: job.id,
          promptId: p.id,
          content: p.content,
          duration: p.duration,
          ratio: p.ratio,
        });
        return job.id;
      })
    );

    return { dispatched: jobs.length, jobIds: jobs };
  },
};
