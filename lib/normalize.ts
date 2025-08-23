// lib/normalize.ts
import { NormalizedAmount, ISODate, ISOCurrency } from "./types";

// ---------- Utilities ----------
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function to5(x: number): string { return (Math.round(clamp01(x) * 1e5) / 1e5).toFixed(5); }

// Tiny deterministic jitter to break ties (does not dominate score)
function djb2(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return ((h >>> 0) % 10000) / 10000; // 0..0.9999
}
function jitter(seed: string, scale = 0.005) { // <= 0.5% effect
  return scale * djb2(seed);
}

// ---------- Existing cleaners (unchanged) ----------
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
  const mYMD = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/;
  const mDMY = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/;
  const named1 = /^([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})$/;
  const named2 = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/;
  const months: Record<string, string> = { jan:"01", feb:"02", mar:"03", apr:"04", may:"05", jun:"06", jul:"07", aug:"08", sep:"09", sept:"09", oct:"10", nov:"11", dec:"12" };
  const mm = (name: string) => months[name.toLowerCase()] ?? "01";
  if (mYMD.test(t)) { const [, y, m, d] = t.match(mYMD)!; return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
  if (mDMY.test(t)) { const [, d, m, y] = t.match(mDMY)!; const Y = y.length === 2 ? `20${y}` : y; return `${Y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`; }
  if (named1.test(t)) { const [, mon, d, y] = t.match(named1)!; return `${y}-${mm(mon)}-${String(d).padStart(2,"0")}`; }
  if (named2.test(t)) { const [, d, mon, y] = t.match(named2)!; return `${y}-${mm(mon)}-${String(d).padStart(2,"0")}`; }
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

// ---------- NEW: semantic scoring ----------
export function rowPointFrom(row: { date: string; description: string; amount: string; currency: string }): string {
  // Features in [0,1]
  const dateOK = row.date !== "unknown" && /^\d{4}-\d{2}-\d{2}$/.test(row.date) ? 1 : 0;
  const amtOK  = /^-?\d+\.\d{2}$/.test(row.amount) ? 1 : 0;
  const descOK = clamp01((row.description || "").replace(/\s+/g, " ").trim().length / 40); // longer (up to 40 chars) → better
  const curOK  = /^[A-Z]{3}$/.test(row.currency) ? 1 : 0;

  // Weights sum ~1.0
  const score =
    0.30 * dateOK +
    0.40 * amtOK +
    0.20 * descOK +
    0.10 * curOK;

  // tiny deterministic jitter: won’t mask bad data but breaks equal ties
  const j = jitter(`${row.date}|${row.description}|${row.amount}|${row.currency}`, 0.005);
  return to5(score + j);
}

export function headerPointFrom(header: {
  bank: string;
  bank_account: string;
  customer_account_number: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  currency: string;
}): string {
  const bankOK   = header.bank !== "unknown" ? 1 : 0;
  const acctOK   = header.bank_account !== "unknown" ? 1 : 0;
  const custOK   = header.customer_account_number !== "unknown" ? 1 : 0;
  const dateOK   = header.statement_date !== "unknown" && /^\d{4}-\d{2}-\d{2}$/.test(header.statement_date) ? 1 : 0;
  const openOK   = /^-?\d+\.\d{2}$/.test(header.opening_balance) ? 1 : 0;
  const closeOK  = /^-?\d+\.\d{2}$/.test(header.closing_balance) ? 1 : 0;
  const currOK   = /^[A-Z]{3}$/.test(header.currency) ? 1 : 0;

  const score =
    0.18 * bankOK +
    0.14 * acctOK +
    0.14 * custOK +
    0.18 * dateOK +
    0.12 * openOK +
    0.12 * closeOK +
    0.12 * currOK;

  const j = jitter(`${header.bank}|${header.bank_account}|${header.customer_account_number}|${header.statement_date}|${header.opening_balance}|${header.closing_balance}|${header.currency}`, 0.005);
  return to5(score + j);
}

export function docPointFrom(
  header: { [k: string]: any },
  rows: Array<{ row_point: string; date: string; description: string; amount: string; currency: string }>
): string {
  const avgRow =
    rows.length ? rows.reduce((s, r) => s + Number(r.row_point), 0) / rows.length : 0;

  // Coverage penalty: fraction of known header fields + fraction of rows with ISO currency
  const headerKnown =
    ["bank","bank_account","customer_account_number","statement_date","opening_balance","closing_balance","currency"]
      .reduce((acc, k) => acc + (header[k] && header[k] !== "unknown" ? 1 : 0), 0) / 7;

  const rowsCurrencyKnown =
    rows.length ? rows.filter(r => /^[A-Z]{3}$/.test(r.currency)).length / rows.length : 0;

  const coverage = 0.6 * headerKnown + 0.4 * rowsCurrencyKnown;

  // Weighted combo with penalty for poor coverage
  const score = clamp01(0.35 * Number(header.row_point || 0) + 0.65 * avgRow - 0.25 * (1 - coverage));
  const j = jitter(`${header.row_point}|${rows.length}`, 0.003);
  return to5(score + j);
}
