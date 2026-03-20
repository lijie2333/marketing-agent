import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const MAX_PDF_TEXT_CHARS = 12000;

export function uploadedFileUrlToPath(url: string): string {
  return path.join(process.cwd(), url);
}

export function getUploadedFileMimeType(
  url: string
): "image/jpeg" | "image/png" | "image/webp" | "application/pdf" {
  const ext = url.split(".").pop()?.toLowerCase();
  const map: Record<string, "image/jpeg" | "image/png" | "image/webp" | "application/pdf"> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    pdf: "application/pdf",
  };
  return map[ext ?? ""] ?? "image/jpeg";
}

export function isPdfFile(url: string) {
  return getUploadedFileMimeType(url) === "application/pdf";
}

export function truncateExtractedText(text: string, maxChars: number) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars)}……`;
}

export async function extractPdfText(filePath: string) {
  try {
    const { stdout } = await execFileAsync("pdftotext", [filePath, "-"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    const extracted = truncateExtractedText(stdout || "", MAX_PDF_TEXT_CHARS);
    if (extracted) {
      return extracted;
    }
  } catch (error) {
    console.warn(`[uploaded-assets] pdftotext 提取失败，准备回退到 pdf-parse: ${filePath}`, error);
  }

  try {
    const { PDFParse } = await import("pdf-parse");
    const buffer = await readFile(filePath);
    const parser = new PDFParse({ data: buffer });

    try {
      const result = await parser.getText();
      return truncateExtractedText(result.text || "", MAX_PDF_TEXT_CHARS);
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    console.error(`[uploaded-assets] PDF 文本提取失败: ${filePath}`, error);
  }

  return "";
}
