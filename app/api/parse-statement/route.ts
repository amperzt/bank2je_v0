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
      const { parseCsv } = await import("@/lib/csv-parser");
      const { rowsToNormalized } = await import("@/lib/rows-to-normalized");
      const rows = parseCsv(buf);
      const normalized = rowsToNormalized(rows /*, optional header meta */);
      return NextResponse.json({ kind, ...normalized });
    }

    if (kind === "xlsx") {
      const { parseXlsx } = await import("@/lib/xlsx-parser");
      const { rowsToNormalized } = await import("@/lib/rows-to-normalized");
      const rawRows: any[] = await parseXlsx(buf);
      // Map sheet rows → {date, description, amount, currency?}
      const rows = rawRows.map(r => ({
        date: r.date ?? r.Date ?? r["Transaction Date"] ?? r["Posting Date"] ?? "",
        description: r.description ?? r.Description ?? r.Details ?? "",
        amount: r.amount ?? r.Amount ?? r["Transaction Amount"] ?? "",
        currency: r.currency ?? r.Currency ?? "",
      }));
      const normalized = rowsToNormalized(rows /*, optional header meta */);
      return NextResponse.json({ kind, ...normalized });
    }

    if (kind === "pdf") {
      const { parsePdfSmart } = await import("@/lib/pdf-parser");
      const pdf = await parsePdfSmart(buf); // { text, warnings? }
      if (pdf.text && pdf.text.trim()) {
        const { parsePdfTextToNormalized } = await import("@/lib/pdf-text-parser");
        const normalized = parsePdfTextToNormalized(pdf.text);
        return NextResponse.json({ kind, ...normalized, warnings: pdf.warnings ?? [] });
      } else {
        // No text (likely scanned) — return empty normalized shell + warnings
        return NextResponse.json({
          kind,
          header: {
            bank: "unknown",
            bank_account: "unknown",
            customer_account_number: "unknown",
            statement_date: "unknown",
            opening_balance: "0.00",
            closing_balance: "0.00",
            currency: "unknown",
            row_point: "0.00000",
          },
          transactions: [],
          footer: { doc_point: "0.00000" },
          warnings: (pdf.warnings ?? []).concat(["No text extracted from PDF."]),
        });
      }
    }

    return NextResponse.json({ error: "Unsupported file type" }, { status: 415 });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Failed to parse statement", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
