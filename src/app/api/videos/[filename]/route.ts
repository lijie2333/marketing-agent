import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const VIDEOS_DIR = path.resolve(process.cwd(), "uploads/videos");

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Sanitize: only allow alphanumeric, hyphens, underscores, and .mp4 extension
  if (!/^[\w-]+\.mp4$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const filepath = path.join(VIDEOS_DIR, filename);

  if (!fs.existsSync(filepath)) {
    return NextResponse.json({ error: "Video not found" }, { status: 404 });
  }

  const stat = fs.statSync(filepath);
  const range = req.headers.get("range");

  // Support range requests for video seeking
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(filepath, { start, end });
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": "video/mp4",
      },
    });
  }

  // Full file response
  const buffer = fs.readFileSync(filepath);
  return new Response(buffer, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Content-Disposition": `inline; filename="${filename}"`,
    },
  });
}
