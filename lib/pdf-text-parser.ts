// lib/pdf-text-parser.ts
import { NormalizedStatement, NormalizedTxn } from "./types";
import {
  cleanBankName,
  cleanIdentifier,
  toISODate,
  normalizeAmount,
  normalizeCurrency,
  rowPointFrom,
  headerPointFrom,
  footerStatsFrom,
} from "./normalize";

// Header field patterns
const RE_ACC_NUM   = /Account\s*Number:\s*([^\n\r]+)/i;
const RE_CUSTOMER  = /Customer:\s*([^\n\r]+)/i; // reserved for later
const RE_STMT_DATE = /Statement\s*Date:\s*([^\n\r]+)/i;
const RE_OPENING   = /Opening\s*Balance:\s*([^\n\r]+)/i;
const RE_CLOSING   = /Closing\s*Balance:\s*([^\n\r]+)/i;
const RE_CURRENCY  = /Currency:\s*([A-Za-z]{3}|[$₱€¥£])/i;

// Transaction row patterns (1=date, 2=desc, 3=amount)
const ROW_PATTERNS: RegExp[] = [
  /^(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-(]?\s?[$₱€¥£]?\s?[0-9,]*\.?[0-9]+[\)]?)\s*$/,            // YYYY-MM-DD
  /^(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\s+(.+?)\s+([-(]?\s?[$₱€¥£]?\s?[0-9,]*\.?[0-9]+[\)]?)\s*$/ // MM/DD/YYYY or DD/MM/YYYY
];

// --- Bank-name inference helpers ---
function looksLikeTableHeader(line: string): boolean {
  const s = line.toLowerCase();
  return s.startsWith("date") || s.includes("description") || s.includes("amount") || s.includes("balance");
}
function containsDateToken(line: string): boolean {
  return /\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/.test(line) || /\b\d{4}-\d{2}-\d{2}\b/.test(line);
}
const BANK_HINTS = [
  "bank","credit","card","mastercard","visa","american express","amex","unionbank",
  "bpi","bdo","citi","citibank","hsbc","chase","wells fargo","capital one","discover"
];
function inferBankNameFromTop(text: string): string {
  const top = text.split(/\r?\n/).slice(0, 12).map(s => s.trim()).filter(Boolean);
  const hinted = top.find(l =>
    !looksLikeTableHeader(l) && !containsDateToken(l) &&
    BANK_HINTS.some(h => l.toLowerCase().includes(h))
  );
  if (hinted) return cleanBankName(hinted);
  const firstEligible = top.find(l => !looksLikeTableHeader(l) && !containsDateToken(l) && l.length >= 6);
  if (firstEligible) return cleanBankName(firstEligible);
  return "unknown";
}

export function parsePdfTextToNormalized(text: string): NormalizedStatement {
  const src = (text ?? "").replace(/\r/g, "");

  // --- Header extraction ---
  const bankRaw   = inferBankNameFromTop(src);
  const accMatch  = src.match(RE_ACC_NUM);
  const /* custMatch */ _custMatch = src.match(RE_CUSTOMER);
  const stmtMatch = src.match(RE_STMT_DATE);
  const openMatch = src.match(RE_OPENING);
  const closeMatch= src.match(RE_CLOSING);
  const currMatch = src.match(RE_CURRENCY);

  const bank = bankRaw || "unknown";

  const accountStr = (accMatch?.[1] ?? "").trim();
  const bank_account = cleanIdentifier(accountStr || "unknown");
  const customer_account_number = cleanIdentifier(accountStr || "unknown");

  // Statement date: explicit or inferred from top lines
  let statement_date = toISODate(stmtMatch?.[1] ?? "unknown");
  if (statement_date === "unknown") {
    const top = src.split(/\r?\n/).slice(0, 20);
    const foundDates = top
      .map(l => l.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})\b/)?.[0])
      .filter(Boolean) as string[];
    const iso = foundDates.map(toISODate).filter(d => d !== "unknown");
    if (iso.length) statement_date = iso.sort().slice(-1)[0];
  }

  const opening_balance  = normalizeAmount(openMatch?.[1] ?? "0");
  const closing_balance  = normalizeAmount(closeMatch?.[1] ?? "0");
  const headerCurrency   = normalizeCurrency(currMatch?.[1] ?? "");

  // --- Transactions ---
  const lines = src
    .split("\n")
    .map(s => s.replace(/\t+/g, " ").replace(/\s{2,}/g, " ").trim())
    .filter(Boolean);

  const txns: NormalizedTxn[] = [];
  for (const line of lines) {
    let m: RegExpExecArray | null = null;
    for (const pat of ROW_PATTERNS) { m = pat.exec(line); if (m) break; }
    if (!m) continue;

    const dRaw   = m[1] ?? "";
    const descRaw= m[2] ?? "";
    const amtRaw = m[3] ?? "";

    const date = toISODate(dRaw);
    const description = descRaw.replace(/\s{2,}/g, " ").trim() || "unknown";
    const amount = normalizeAmount(amtRaw);

    // Currency precedence: txn -> header -> unknown
    const txnCur = normalizeCurrency(amtRaw);
    const currency = txnCur || headerCurrency || "unknown";

    const row: NormalizedTxn = {
      date, description, amount, currency,
      row_point: rowPointFrom({ date, description, amount, currency }),
    };
    txns.push(row);
  }

  // --- Header (with row_point) ---
  const headerTmp = {
    bank,
    bank_account,
    customer_account_number,
    statement_date,
    opening_balance,
    closing_balance,
    currency: headerCurrency || (txns[0]?.currency ?? "unknown"),
  };
  const header = { ...headerTmp, row_point: headerPointFrom(headerTmp) };

  // --- Footer (num_transactions, total_amount_parsed, balanced, doc_point) ---
  const footer = footerStatsFrom(header, txns);

  return { header, transactions: txns, footer };
}
