import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// UPLOAD_DIR is the server filesystem path; public URL prefix is always /uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || "./uploads";
const PUBLIC_URL_PREFIX = "/uploads";
const MAX_SIZE_MB = 10;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const uploadType = searchParams.get("type");

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return NextResponse.json({ error: "No file" }, { status: 400 });
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return NextResponse.json({ error: `File exceeds ${MAX_SIZE_MB}MB` }, { status: 413 });
  }

  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 415 });
  }

  const merchantDir = path.join(UPLOAD_DIR, session.user.id);

  // If type=logo, use logos subdirectory
  const uploadDir = uploadType === "logo"
    ? path.join(merchantDir, "logos")
    : merchantDir;

  await mkdir(uploadDir, { recursive: true });

  const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
  const filepath = path.join(uploadDir, filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = uploadType === "logo"
    ? `${PUBLIC_URL_PREFIX}/${session.user.id}/logos/${filename}`
    : `${PUBLIC_URL_PREFIX}/${session.user.id}/${filename}`;

  return NextResponse.json({ url });
}
