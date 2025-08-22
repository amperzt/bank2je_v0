export const runtime = "nodejs";           // avoid Edge, pdf libs break there
export const dynamic = "force-dynamic";    // file uploads, no caching

import { NextResponse } from "next/server";

type Detected = { kind: "csv" | "pdf" | "xlsx" | "unknown"; buf: Buffer };

async function readFileFromForm(req: Request): Promise<Detected> {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab);

  // magic bytes + extension sanity
  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const first4 = buf.slice(0, 4).toString("ascii");

  if (name.endsWith(".csv") || mime.includes("text/csv")) return { kind: "csv", buf };
  if (first4 === "%PDF" || name.endsWith(".pdf") || mime.includes("pdf")) return { kind: "pdf", buf };
  if (name.endsWith(".xlsx") || mime.includes("spreadsheet")) return { kind: "xlsx", buf };

  return { kind: "unknown", buf };
}

export async function POST(req: Request) {
  try {
    const { kind, buf } = await readFileFromForm(req);

    if (kind === "csv") {
      const { parseCsv } = await import("@/lib/csv-parser"); // ✅ lazy
      const rows = parseCsv(buf);
      return NextResponse.json({ kind, rows });
      console.log("[api] csv rows:", rows.length);
    }

    if (kind === "pdf") {
      // Lazy import PDF parser so it doesn't execute unless needed
      const { parsePdfSmart } = await import("@/lib/pdf-parser"); // ✅ lazy
      const result = await parsePdfSmart(buf);
      return NextResponse.json({ kind, ...result });
    }

    if (kind === "xlsx") {
      const { parseXlsx } = await import("@/lib/xlsx-parser"); // optional
      const rows = await parseXlsx(buf);
      return NextResponse.json({ kind, rows });
    }

    return NextResponse.json(
      { error: "Unsupported file type" },
      { status: 415 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse statement", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
