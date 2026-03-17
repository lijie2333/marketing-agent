import { GoogleGenerativeAI } from "@google/generative-ai";

const globalForGemini = globalThis as unknown as { gemini: GoogleGenerativeAI };

export const gemini =
  globalForGemini.gemini ||
  new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

if (process.env.NODE_ENV !== "production") globalForGemini.gemini = gemini;
