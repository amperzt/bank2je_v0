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
  docPointFrom,
} from "./normalize";

// Header field patterns (tolerant to spacing/case)
const RE_ACC_NUM     = /Account\s*Number:\s*([^\n\r]+)/i;
const RE_CUSTOMER    = /Customer:\s*([^\n\r]+)/i; // kept if you later want a distinct customer id/name
const RE_STMT_DATE   = /Statement\s*Date:\s*([^\n\r]+)/i;
const RE_OPENING     = /Opening\s*Balance:\s*([^\n\r]+)/i;
const RE_CLOSING     = /Closing\s*Balance:\s*([^\n\r]+)/i;
const RE_CURRENCY    = /Currency:\s*([A-Za-z]{3}|[$₱€¥£])/i;

// Transactions like:
// 2025-08-05  STARBUCKS COFFEE NEW YORK        (12.34)
// 2025-08-10  CARD PAYMENT                      0.00
// Capture: ISO date, description (greedy/trim), amount (with () or -)
const RE_TABLE_ROW =
  /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-\(]?[0-9,]*\.?[0-9]+[\)]?)(?:\s|$)/;

function inferBankNameFromTop(text: string): string {
  const top = text.split(/\r?\n/).slice(0, 6).map(s => s.trim()).filter(Boolean);
  // Try to use the first line that contains "STATEMENT" minus that word; else first non-empty line
  const candidate = top.find(l => /STATEMENT/i.test(l))?.replace(/STATEMENT/gi, "").trim()
                 || top[0]
                 || "unknown";
  return cleanBankName(candidate || "unknown");
}

export function parsePdfTextToNormalized(text: string): NormalizedStatement {
  const src = (text ?? "").replace(/\r/g, "");

  // --- Header extraction ---
  const bankRaw   = inferBankNameFromTop(src);
  const accMatch  = src.match(RE_ACC_NUM);
  const custMatch = src.match(RE_CUSTOMER);
  const stmtMatch = src.match(RE_STMT_DATE);
  const openMatch = src.match(RE_OPENING);
  const closeMatch= src.match(RE_CLOSING);
  const currMatch = src.match(RE_CURRENCY);

  const bank = bankRaw || "unknown";

  // As discussed, for now bank_account and customer_account_number use same capture;
  // if you later add a distinct field for customer, swap `custMatch` in accordingly.
  const accountStr = (accMatch?.[1] ?? "").trim();
  const bank_account = cleanIdentifier(accountStr || "unknown");
  const customer_account_number = cleanIdentifier(accountStr || "unknown");

  const statement_date   = toISODate(stmtMatch?.[1] ?? "unknown");
  const opening_balance  = normalizeAmount(openMatch?.[1] ?? "0");
  const closing_balance  = normalizeAmount(closeMatch?.[1] ?? "0");
  const headerCurrency   = normalizeCurrency(currMatch?.[1] ?? "");

  // --- Transactions ---
  const lines = src.split("\n").map(s => s.trim()).filter(Boolean);
  const txns: NormalizedTxn[] = [];

  for (const line of lines) {
    const m = line.match(RE_TABLE_ROW);
    if (!m) continue;

    const [, d, descRaw, amtRaw] = m;
    const date = toISODate(d);
    const description = descRaw.replace(/\s{2,}/g, " ").trim() || "unknown";
    const amount = normalizeAmount(amtRaw);
    // Prefer header currency; if not present try to normalize from amount token itself; else unknown
    const currency = headerCurrency || normalizeCurrency(amtRaw) || "unknown";

    const row: NormalizedTxn = {
      date,
      description,
      amount,
      currency,
      row_point: rowPointFrom({ date, description, amount, currency }),
    };
    txns.push(row);
  }

  // --- Header scoring ---
  const headerTmp = {
    bank,
    bank_account,
    customer_account_number,
    statement_date,
    opening_balance,
    closing_balance,
    currency: headerCurrency || (txns[0]?.currency ?? "unknown"),
  };
  const header = {
    ...headerTmp,
    row_point: headerPointFrom(headerTmp),
  };

  // --- Footer doc-level point ---
  const footer = {
    doc_point: docPointFrom(header, txns),
  };

  return { header, transactions: txns, footer };
}
