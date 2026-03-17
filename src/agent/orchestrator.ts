import { gemini } from "@/lib/gemini";
import { skillRegistry } from "@/skills/registry";

const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_TOOL_RETRIES = 2;

export interface AgentContext {
  systemPrompt: string;
  userMessage: string;
}

export async function runAgent(context: AgentContext): Promise<string> {
  const model = gemini.getGenerativeModel({
    model: "gemini-1.5-pro",
    tools: skillRegistry.toGeminiTools(),
  });

  const chat = model.startChat({
    systemInstruction: context.systemPrompt,
  });

  const deadline = Date.now() + TIMEOUT_MS;
  let response = await chat.sendMessage(context.userMessage);

  while (Date.now() < deadline) {
    const candidate = response.response.candidates?.[0];
    if (!candidate) throw new Error("No candidate in Gemini response");

    const parts = candidate.content.parts;
    const toolCalls = parts.filter((p) => p.functionCall);

    if (toolCalls.length === 0) {
      // Terminal: text response
      return response.response.text();
    }

    // Execute tool calls
    const toolResults = await Promise.all(
      toolCalls.map(async (part) => {
        const call = part.functionCall!;
        let result: unknown;
        let attempts = 0;
        while (attempts <= MAX_TOOL_RETRIES) {
          try {
            result = await skillRegistry.invoke(
              call.name,
              call.args as Record<string, unknown>
            );
            break;
          } catch (err) {
            attempts++;
            if (attempts > MAX_TOOL_RETRIES) {
              result = { error: (err as Error).message };
            }
          }
        }
        return {
          functionResponse: { name: call.name, response: { result } },
        };
      })
    );

    response = await chat.sendMessage(toolResults);
  }

  throw new Error("Agent timeout after 5 minutes");
}
