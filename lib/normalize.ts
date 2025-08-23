// lib/normalize.ts
import { NormalizedAmount, ISODate, ISOCurrency } from "./types";

function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function to5(x: number): string { return (Math.round(clamp01(x) * 1e5) / 1e5).toFixed(5); }

// Tiny deterministic jitter to break ties a bit (<=0.5%)
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return ((h >>> 0) % 10000) / 10000;
}
function jitter(seed: string, scale = 0.005) { return scale * djb2(seed); }

// ===== Existing cleaners (unchanged) =====
export function cleanBankName(raw: string): string {
  const s = (raw ?? "").toString().trim();
  const keep = s.replace(/[^A-Za-z0-9 ]+/g, "").replace(/\s+/g, "");
  return keep || "unknown";
}
export function cleanIdentifier(raw: string): string {
  const s = (raw ?? "").toString();
  const out = s.replace(/[^A-Za-z0-9]/g, "");
  return out || "unknown";
}
export function toISODate(raw: string): ISODate {
  const t = (raw ?? "").toString().trim();
  if (!t) return "unknown";

  const mYMD = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;        // 2025-07-31
  const mDMY = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;       // 31/07/2025
  const mMDY = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;       // 07/31/2025
  const named1 = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/;        // Aug 31, 2025
  const named2 = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/;         // 31 Aug 2025
  const months: Record<string,string> = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06",
    jul:"07", aug:"08", sep:"09", sept:"09", oct:"10", nov:"11", dec:"12" };
  const mm = (name: string) => months[name.toLowerCase()] ?? "01";

  // strict Y-M-D
  if (mYMD.test(t)) { const [, y,m,d] = t.match(mYMD)!; return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }

  // if dd first & day > 12 assume DMY, else if month > 12 assume MDY
  if (mDMY.test(t)) {
    const [, d,m,y] = t.match(mDMY)!;
    const Y = y.length === 2 ? `20${y}` : y;
    if (Number(d) > 12) return `${Y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }
  if (mMDY.test(t)) {
    const [, m,d,y] = t.match(mMDY)!;
    const Y = y.length === 2 ? `20${y}` : y;
    if (Number(m) > 12 || Number(d) <= 12) return `${Y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  if (named1.test(t)) { const [, mon,d,y] = t.match(named1)!; return `${y}-${mm(mon)}-${String(d).padStart(2,"0")}`; }
  if (named2.test(t)) { const [, d,mon,y] = t.match(named2)!; return `${y}-${mm(mon)}-${String(d).padStart(2,"0")}`; }

  return "unknown";
}
const SYMBOL_TO_ISO: Record<string, ISOCurrency> = { "$":"USD","₱":"PHP","PHP":"PHP","USD":"USD","€":"EUR","¥":"JPY","£":"GBP" };
export function normalizeCurrency(input?: string): ISOCurrency {
  const s = (input ?? "").toString().trim().toUpperCase();
  if (!s) return "unknown";
  if (SYMBOL_TO_ISO[s]) return SYMBOL_TO_ISO[s];
  if (/^[A-Z]{3}$/.test(s)) return s as ISOCurrency;
  for (const sym of Object.keys(SYMBOL_TO_ISO)) if (s.includes(sym)) return SYMBOL_TO_ISO[sym];
  return "unknown";
}
export function normalizeAmount(raw: string): NormalizedAmount {
  let s = (raw ?? "").toString().trim();
  if (!s) return "0.00";
  const parenNeg = /^\(.*\)$/.test(s);
  s = s.replace(/[(),]/g, "").replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === ".") return "0.00";
  let n = Number(s); if (Number.isNaN(n)) n = 0;
  if (parenNeg) n = -Math.abs(n);
  return n.toFixed(2);
}


// ===== Money math helpers =====
export function amountToNumber(a: string): number {
  const n = Number((a || "0").replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
export function sumAmounts(vals: string[]): string {
  const cents = vals.reduce((acc, v) => acc + Math.round(amountToNumber(v) * 100), 0);
  return (cents / 100).toFixed(2);
}
export function equalsMoney(a: string, b: string): boolean {
  return amountToNumber(a).toFixed(2) === amountToNumber(b).toFixed(2);
}

// ===== Semantic scoring =====
export function rowPointFrom(row: { date: string; description: string; amount: string; currency: string }): string {
  const dateOK = row.date !== "unknown" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? 1 : 0;
  const amtOK  = /^-?\d+\.\d{2}$/.test(row.amount) ? 1 : 0;
  const descOK = Math.max(0, Math.min(1, (row.description || "").replace(/\s+/g, " ").trim().length / 40));
  const curOK  = /^[A-Z]{3}$/.test(row.currency) ? 1 : 0;
  const score = 0.30*dateOK + 0.40*amtOK + 0.20*descOK + 0.10*curOK;
  const j = jitter(`${row.date}|${row.description}|${row.amount}|${row.currency}`, 0.005);
  return to5(score + j);
}

export function headerPointFrom(header: {
  bank: string; bank_account: string; customer_account_number: string;
  statement_date: string; opening_balance: string; closing_balance: string; currency: string;
}): string {
  const bankOK  = header.bank !== "unknown" ? 1 : 0;
  const acctOK  = header.bank_account !== "unknown" ? 1 : 0;
  const custOK  = header.customer_account_number !== "unknown" ? 1 : 0;
  const dateOK  = header.statement_date !== "unknown" && /^\d{4}-\d{2}-\d{2}$/.test(header.statement_date) ? 1 : 0;
  const openOK  = /^-?\d+\.\d{2}$/.test(header.opening_balance) ? 1 : 0;
  const closeOK = /^-?\d+\.\d{2}$/.test(header.closing_balance) ? 1 : 0;
  const currOK  = /^[A-Z]{3}$/.test(header.currency) ? 1 : 0;
  const score = 0.18*bankOK + 0.14*acctOK + 0.14*custOK + 0.18*dateOK + 0.12*openOK + 0.12*closeOK + 0.12*currOK;
  const j = jitter(`${header.bank}|${header.bank_account}|${header.customer_account_number}|${header.statement_date}|${header.opening_balance}|${header.closing_balance}|${header.currency}`, 0.005);
  return to5(score + j);
}

// New doc-point spec:
// mean(header_row_point + avg(row_points)) + 0.1 bonus if opening + sum(txns) == closing (cap at 1.0)
export function docPointFrom(
  header: { row_point: string; opening_balance: string; closing_balance: string },
  rows: Array<{ row_point: string; amount: string }>
): string {
  const headerNum = Number(header.row_point || "0");
  const avgRow = rows.length ? rows.reduce((s, r) => s + Number(r.row_point || "0"), 0) / rows.length : 0;
  const base = (headerNum + avgRow) / 2;

  const total = sumAmounts(rows.map(r => r.amount));
  const balanced = equalsMoney(sumAmounts([header.opening_balance, total]), header.closing_balance);
  const bonus = balanced ? 0.1 : 0;

  const final = Math.min(1, base + bonus);
  return (Math.round(final * 1e5) / 1e5).toFixed(5);
}

export function footerStatsFrom(
  header: { row_point: string; opening_balance: string; closing_balance: string },
  rows: Array<{ row_point: string; amount: string }>
): { num_transactions: number; total_amount_parsed: string; balanced: boolean; doc_point: string } {
  const num_transactions = rows.length;
  const total_amount_parsed = sumAmounts(rows.map(r => r.amount));
  const balanced = equalsMoney(sumAmounts([header.opening_balance, total_amount_parsed]), header.closing_balance);
  const doc_point = docPointFrom(header, rows);
  return { num_transactions, total_amount_parsed, balanced, doc_point };
}
