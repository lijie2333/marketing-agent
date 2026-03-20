import { db } from "@/lib/db";
import { videoQueue } from "@/lib/queue";
import type { SkillDefinition } from "./registry";
import { SchemaType } from "@google/generative-ai";

export const jobDispatcherSkill: SkillDefinition = {
  name: "job-dispatcher",
  description: "Dispatch confirmed prompts to the video generation queue.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      strategyId: { type: SchemaType.STRING, description: "Strategy ID to dispatch all confirmed prompts for" },
      merchantId: { type: SchemaType.STRING, description: "Merchant ID used to scope prompt ownership" },
      promptIds: { type: SchemaType.STRING, description: "Optional JSON array of selected prompt IDs" },
      sampleSizePerDirection: { type: SchemaType.STRING, description: "How many sample prompts to dispatch per direction" },
    },
    required: ["strategyId", "merchantId"],
  },
  handler: async (params) => {
    const selectedPromptIds = params.promptIds
      ? (JSON.parse(params.promptIds as string) as string[])
      : null;
    const sampleSizePerDirection = Math.max(
      1,
      parseInt((params.sampleSizePerDirection as string) || "2", 10) || 2
    );

    const prompts = await db.prompt.findMany({
      where: {
        strategyId: params.strategyId as string,
        isConfirmed: true,
        complianceStatus: "APPROVED",
        videoJob: null,
        productionBatchId: null,
        ...(selectedPromptIds ? { id: { in: selectedPromptIds } } : {}),
        strategy: { brandProfile: { merchantId: params.merchantId as string } },
      },
      orderBy: [{ direction: "asc" }, { createdAt: "asc" }],
    });

    if (prompts.length === 0) {
      return {
        dispatched: 0,
        sampleDispatched: 0,
        bulkPending: 0,
        batchId: null,
      };
    }

    const groups = new Map<string, typeof prompts>();
    for (const prompt of prompts) {
      const existing = groups.get(prompt.direction) ?? [];
      existing.push(prompt);
      groups.set(prompt.direction, existing);
    }

    const samplePromptIds: string[] = [];
    const bulkPromptIds: string[] = [];

    for (const directionPrompts of groups.values()) {
      directionPrompts.forEach((prompt, index) => {
        if (index < sampleSizePerDirection) {
          samplePromptIds.push(prompt.id);
        } else {
          bulkPromptIds.push(prompt.id);
        }
      });
    }

    const batch = await db.productionBatch.create({
      data: {
        strategyId: params.strategyId as string,
        sampleSizePerDirection,
        totalPrompts: prompts.length,
        samplePrompts: samplePromptIds.length,
        bulkPrompts: bulkPromptIds.length,
        status: "SAMPLE_QUEUED",
        sampleDispatchedAt: new Date(),
      },
    });

    if (samplePromptIds.length > 0) {
      await db.prompt.updateMany({
        where: { id: { in: samplePromptIds } },
        data: {
          productionBatchId: batch.id,
          productionPhase: "SAMPLE",
        },
      });
    }

    if (bulkPromptIds.length > 0) {
      await db.prompt.updateMany({
        where: { id: { in: bulkPromptIds } },
        data: {
          productionBatchId: batch.id,
          productionPhase: "BULK",
        },
      });
    }

    const samplePrompts = prompts.filter((p) => samplePromptIds.includes(p.id));

    const jobs = await Promise.all(
      samplePrompts.map(async (p) => {
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

    return {
      dispatched: jobs.length,
      sampleDispatched: samplePromptIds.length,
      bulkPending: bulkPromptIds.length,
      totalSelected: prompts.length,
      batchId: batch.id,
      jobIds: jobs,
    };
  },
};
