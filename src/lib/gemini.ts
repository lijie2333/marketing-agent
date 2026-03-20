import {
  GoogleGenerativeAI,
  type ModelParams,
  type RequestOptions,
} from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";

const globalForGemini = globalThis as unknown as { gemini?: GoogleGenerativeAI };
const DEFAULT_GEMINI_MODEL = "gemini-3.1-pro-preview";
const DEFAULT_GEMINI_ANALYSIS_MODEL = "gemini-3.1-flash-lite-preview";

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("缺少 GEMINI_API_KEY，无法调用 Gemini。请在 .env.local 中配置后重启服务。");
  }

  return apiKey;
}

function getGeminiRequestOptions(): RequestOptions | undefined {
  const baseUrl = process.env.GEMINI_BASE_URL?.trim();
  return baseUrl ? { baseUrl } : undefined;
}

function getGeminiClient() {
  if (!globalForGemini.gemini) {
    globalForGemini.gemini = new GoogleGenerativeAI(getGeminiApiKey());
  }

  return globalForGemini.gemini;
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { status?: number };
  return typeof candidate.status === "number" ? candidate.status : undefined;
}

function isRetryableGeminiError(error: unknown) {
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : "";

  return message.includes("fetch failed") || status === 429 || (status !== undefined && status >= 500);
}

function normalizeGeminiError(error: unknown) {
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : "";

  if (status === 401 || status === 403) {
    return new Error("Gemini 调用被拒绝，请检查 GEMINI_API_KEY 是否有效，以及账号是否开通对应模型权限。");
  }

  if (status === 429) {
    return new Error("Gemini 配额不足或请求过快，请稍后再试。");
  }

  if (status !== undefined && status >= 500) {
    return new Error("Gemini 服务暂时不可用，请稍后重试。");
  }

  if (message.includes("fetch failed")) {
    return new Error(
      "Gemini 网络请求失败，当前服务无法连接 Google AI 接口。请检查服务器网络，或在 .env.local 中配置 GEMINI_BASE_URL 指向可访问的代理/网关后重启服务。"
    );
  }

  return error instanceof Error ? error : new Error("Gemini 调用失败，请稍后重试。");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getGeminiModel(modelParams: ModelParams) {
  return getGeminiClient().getGenerativeModel(modelParams, getGeminiRequestOptions());
}

export function getDefaultGeminiModelName() {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

export function getDefaultGeminiAnalysisModelName() {
  return process.env.GEMINI_ANALYSIS_MODEL?.trim() || getDefaultGeminiModelName() || DEFAULT_GEMINI_ANALYSIS_MODEL;
}

export function createGeminiFileManager() {
  return new GoogleAIFileManager(getGeminiApiKey(), getGeminiRequestOptions());
}

export async function withGeminiRetry<T>(
  label: string,
  task: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (!isRetryableGeminiError(error) || attempt === maxAttempts) {
        throw normalizeGeminiError(error);
      }

      console.warn(`[gemini] ${label} failed on attempt ${attempt}/${maxAttempts}, retrying...`);
      await sleep(800 * attempt);
    }
  }

  throw normalizeGeminiError(lastError);
}
