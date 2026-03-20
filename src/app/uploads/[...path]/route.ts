import fs from "fs";
import path from "path";

const UPLOAD_DIR = path.resolve(process.cwd(), process.env.UPLOAD_DIR || "./uploads");

const CONTENT_TYPES: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function resolvePublicUploadPath(segments: string[]) {
  const normalizedRelativePath = path.normalize(segments.join("/"));
  const absolutePath = path.resolve(UPLOAD_DIR, normalizedRelativePath);

  if (!absolutePath.startsWith(`${UPLOAD_DIR}${path.sep}`) && absolutePath !== UPLOAD_DIR) {
    return null;
  }

  return absolutePath;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: segments } = await params;

  if (!segments?.length) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = resolvePublicUploadPath(segments);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return new Response("Not found", { status: 404 });
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const fileBuffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  return new Response(fileBuffer, {
    headers: {
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": `inline; filename="${fileName}"`,
      "Content-Length": String(fileBuffer.length),
      "Content-Type": contentType,
    },
  });
}
