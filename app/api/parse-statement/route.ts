// app/api/parse-statement/route.ts
export const runtime = "nodejs";        // keep PDF libs happy
export const dynamic = "force-dynamic"; // file uploads + no caching
import type { PdfParseResult } from "@/lib/types"; // or "@/lib/pdf-parser" if exported there

import { NextResponse } from "next/server";
import type { InRow } from "@/lib/rows-to-normalized";

type Detected = { kind: "csv" | "pdf" | "xlsx" | "unknown"; buf: Buffer };

async function readFileFromForm(req: Request): Promise<Detected> {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) throw new Error("No file uploaded");

  const ab = await file.arrayBuffer();
  const buf = Buffer.from(ab); // ✅ modern Buffer API

  const name = (file.name || "").toLowerCase();
  const mime = (file.type || "").toLowerCase();
  const first4 = buf.slice(0, 4).toString("ascii");

  if (name.endsWith(".csv") || mime.includes("text/csv")) return { kind: "csv", buf };
  if (first4 === "%PDF" || name.endsWith(".pdf") || mime.includes("pdf")) return { kind: "pdf", buf };
  if (name.endsWith(".xlsx") || mime.includes("spreadsheet")) return { kind: "xlsx", buf };

  return { kind: "unknown", buf };
}

export async function POST(req: Request) {
  // Optional: quick runtime debug → POST /api/parse-statement?debug=1
  const url = new URL(req.url);
  if (url.searchParams.get("debug") === "1" || req.headers.get("x-debug-runtime") === "1") {
    return NextResponse.json({
      runtime: process.env.NEXT_RUNTIME || "unknown",
      nodeVersion: process.version,
      platform: process.platform,
    });
  }

  try {
    const { kind, buf } = await readFileFromForm(req);

    if (kind === "csv") {
      const { parseCsv } = await import("@/lib/csv-parser");
      const { rowsToNormalized } = await import("@/lib/rows-to-normalized");

      // Whatever your CSV parser returns, map to InRow[]
      const rawRows = (parseCsv as any)(buf) as any[];
      const inRows: InRow[] = (rawRows ?? []).map((r: any) => ({
        date: String(r.date ?? r.Date ?? r["Transaction Date"] ?? r["Date"] ?? "").trim(),
        description: String(r.description ?? r.Description ?? r["Details"] ?? r["Narration"] ?? "").trim(),
        amount: String(r.amount ?? r.Amount ?? r["Debit"] ?? r["Credit"] ?? "").trim(),
        currency: String(r.currency ?? r.Currency ?? "").trim(),
      }));

      const normalized = rowsToNormalized(inRows);
      return NextResponse.json({ kind, ...normalized });
    }

    if (kind === "pdf") {
      const { parsePdfSmart } = await import("@/lib/pdf-parser");
      const pdf = await parsePdfSmart(buf); // { text, warnings?, strategy? }

      if (pdf.text && pdf.text.trim()) {
        const { parsePdfTextToNormalized } = await import("@/lib/pdf-text-parser");
        const normalized = parsePdfTextToNormalized(pdf.text);
        return NextResponse.json({
          kind,
          strategy: pdf.strategy,
          ...normalized,
          warnings: pdf.warnings ?? [],
        });
      }

      // No text at all — surface parser warnings
      return NextResponse.json(
        { error: "No extractable text", details: (pdf.warnings ?? []).join(" | ") || "unknown" },
        { status: 422 }
      );
    }

    if (kind === "xlsx") {
      const { parseXlsx } = await import("@/lib/xlsx-parser");
      const { rowsToNormalized } = await import("@/lib/rows-to-normalized");

      const rawRows = await (parseXlsx as any)(buf); // any[]
      const inRows: InRow[] = (rawRows ?? []).map((r: any) => ({
        date: String(r.date ?? r.Date ?? r["Transaction Date"] ?? r["Date"] ?? "").trim(),
        description: String(r.description ?? r.Description ?? r["Details"] ?? r["Narration"] ?? "").trim(),
        amount: String(r.amount ?? r.Amount ?? r["Debit"] ?? r["Credit"] ?? "").trim(),
        currency: String(r.currency ?? r.Currency ?? "").trim(),
      }));

      const normalized = rowsToNormalized(inRows);
      return NextResponse.json({ kind, ...normalized });
    }

    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse statement", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
