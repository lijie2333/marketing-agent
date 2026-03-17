import {
  SchemaType,
  FunctionDeclarationSchema,
  FunctionDeclarationSchemaProperty,
} from "@google/generative-ai";

export interface SkillDefinition {
  name: string;
  description: string;
  parameters: {
    type: SchemaType.OBJECT;
    properties: Record<string, FunctionDeclarationSchemaProperty>;
    required: string[];
  };
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition) {
    this.skills.set(skill.name, skill);
  }

  getAll(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  async invoke(name: string, params: Record<string, unknown>): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`Skill not found: ${name}`);
    return skill.handler(params);
  }

  toGeminiTools() {
    return [
      {
        functionDeclarations: this.getAll().map((s) => ({
          name: s.name,
          description: s.description,
          parameters: s.parameters as FunctionDeclarationSchema,
        })),
      },
    ];
  }
}

export const skillRegistry = new SkillRegistry();

// Auto-register all skills
import { brandAnalyzerSkill } from "./brand-analyzer";
skillRegistry.register(brandAnalyzerSkill);

import { strategyPlannerSkill } from "./strategy-planner";
import { seedancePrompterSkill } from "./seedance-prompter";
import { complianceCheckerSkill } from "./compliance-checker";
skillRegistry.register(strategyPlannerSkill);
skillRegistry.register(seedancePrompterSkill);
skillRegistry.register(complianceCheckerSkill);

import { jobDispatcherSkill } from "./job-dispatcher";
skillRegistry.register(jobDispatcherSkill);
