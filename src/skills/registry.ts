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
