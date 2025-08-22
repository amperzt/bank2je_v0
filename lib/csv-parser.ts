import { parse } from "csv-parse/sync";

export type Txn = {
  date: string;        // YYYY-MM-DD
  description: string;
  amount: string;      // "0.00"
  currency?: string;   // optional for CSV MVP
};

function toIsoDate(s: string): string {
  const t = s.trim();
  // try common formats: dd/mm/yyyy, mm/dd/yyyy, yyyy-mm-dd, dd-mm-yyyy
  const dmy = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/;
  const ymd = /^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/;
  if (ymd.test(t)) {
    const [, y, m, d] = t.match(ymd)!;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  if (dmy.test(t)) {
    const [, d, m, y] = t.match(dmy)!;
    return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
  }
  // fallback: return as-is for now (your scoring will penalize)
  return t;
}

function normalizeAmount(raw: string): string {
  // handle parentheses negatives and commas
  let s = raw.trim();
  const neg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),]/g, "").replace(/[^\d\.\-]/g, "");
  if (!s) s = "0";
  let num = Number(s);
  if (Number.isNaN(num)) num = 0;
  if (neg) num = -Math.abs(num);
  return num.toFixed(2);
}

export function parseCsv(buffer: Buffer): Txn[] {
  // auto delimiter detection (comma/semicolon)
  const sample = buffer.slice(0, 4096).toString("utf8");
  const delimiter = sample.split("\n")[0].includes(";") ? ";" : ",";

  // Try header=true; if that yields nonsense, fallback
  const rows: any[] = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    delimiter,
  });

  if (rows.length && Object.keys(rows[0]).length >= 3) {
    // header case: try to map reasonable column names
    return rows.map((r) => {
      // heuristic column picks
      const date = r.date ?? r.Date ?? r.DATE ?? r["Transaction Date"] ?? r["Posting Date"] ?? "";
      const desc = r.description ?? r.Description ?? r.DESC ?? r["Details"] ?? r["Description 1"] ?? "";
      const amt  = r.amount ?? r.Amount ?? r.AMOUNT ?? r["Transaction Amount"] ?? r["Amount (PHP)"] ?? r["Amount (USD)"] ?? "";

      return {
        date: toIsoDate(String(date ?? "")),
        description: String(desc ?? "").trim(),
        amount: normalizeAmount(String(amt ?? "")),
      };
    }).filter(t => t.description !== "");
  }

  // no-header fallback: assume [Date, Description, Amount]
  const simple: any[] = parse(buffer, {
    columns: false,
    skip_empty_lines: true,
    trim: true,
    delimiter,
  });

  return simple.map((cols) => {
    const [d, desc, amt] = cols;
    return {
      date: toIsoDate(String(d ?? "")),
      description: String(desc ?? "").trim(),
      amount: normalizeAmount(String(amt ?? "")),
    };
  }).filter(t => t.description !== "");
}
