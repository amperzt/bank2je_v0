import { parse } from "csv-parse/sync";

export type Txn = {
  date: string;
  description: string;
  amount: string;
  currency?: string;
};

function toIsoDate(s: string): string {
  const t = (s ?? "").toString().trim();
  const ymd = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;
  const dmy = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;
  if (ymd.test(t)) {
    const [, y, m, d] = t.match(ymd)!;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (dmy.test(t)) {
    const [, d, m, y] = t.match(dmy)!;
    const Y = y.length === 2 ? `20${y}` : y;
    return `${Y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return t;
}

function normalizeAmount(raw: string): string {
  let s = (raw ?? "").toString().trim();
  const parenNeg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),]/g, "").replace(/[^\d.\-]/g, "");
  let num = Number(s || "0");
  if (Number.isNaN(num)) num = 0;
  if (parenNeg) num = -Math.abs(num);
  return num.toFixed(2);
}

// Detect if the first row looks like a header row
function isHeaderLikeRow(cols: any[]): boolean {
  if (!Array.isArray(cols)) return false;
  const lowered = cols.map(c => String(c ?? "").trim().toLowerCase());
  return (
    lowered.includes("date") &&
    (lowered.includes("description") || lowered.join(",").includes("details")) &&
    (lowered.includes("amount") || lowered.includes("debit") || lowered.includes("credit"))
  );
}

function mapHeaderRow(r: Record<string, any>): Txn {
  const date =
    r.date ??
    r.Date ??
    r.DATE ??
    r.TransDate ??
    r["Transaction Date"] ??
    r["Posting Date"] ??
    r["Date"] ??
    "";
  const desc =
    r.description ??
    r.Description ??
    r.DESCRIPTION ??
    r.Merchant ??
    r.MERCHANT ??
    r["Details"] ??
    r["Description 1"] ??
    r["Narration"] ??
    "";
  const amt =
    r.amount ??
    r.Amount ??
    r.AMOUNT ??
    r["Transaction Amount"] ??
    r["Amount (PHP)"] ??
    r["Amount (USD)"] ??
    r["Amount"] ??
    "";
  return {
    date: toIsoDate(String(date)),
    description: String(desc ?? "").trim(),
    amount: normalizeAmount(String(amt)),
  };
}

function mapNoHeaderRow(cols: any[]): Txn {
  const [d, desc, amt] = cols;
  return {
    date: toIsoDate(String(d ?? "")),
    description: String(desc ?? "").trim(),
    amount: normalizeAmount(String(amt ?? "")),
  };
}

function scoreRows(rows: Txn[]): number {
  let score = 0;
  for (const r of rows) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(r.date) || /\d/.test(r.date)) score += 2;
    if (/^-?\d+\.\d{2}$/.test(r.amount)) score += 1;
    if (/[A-Za-z]/.test(r.description)) score += 1;
  }
  return score;
}

export function parseCsv(buffer: Buffer): Txn[] {
  const sample = buffer.slice(0, 4096).toString("utf8");
  const delimiter = sample.split("\n")[0].includes(";") ? ";" : ",";

  // --- Attempt 1: parse with headers ---
  let headerRows: any[] = [];
  try {
    headerRows = parse(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      delimiter,
    });
  } catch {}
  const mappedHeader = headerRows.map(mapHeaderRow).filter(r => r.description);

  // --- Attempt 2: parse without headers ---
  let simpleRows: any[] = [];
  try {
    simpleRows = parse(buffer, {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      delimiter,
    });
  } catch {}
  const mappedSimple = simpleRows
    .filter((cols, idx) => (idx === 0 ? !isHeaderLikeRow(cols) : true))
    .map(mapNoHeaderRow)
    .filter(r => r.description);

  // --- Score both, pick best ---
  const scoreHeader = scoreRows(mappedHeader);
  const scoreSimple = scoreRows(mappedSimple);

  if (scoreSimple > scoreHeader || (scoreSimple === scoreHeader && mappedSimple.length > mappedHeader.length)) {
    return mappedSimple;
  }
  return mappedHeader;
}
