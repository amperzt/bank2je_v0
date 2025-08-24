// lib/rows-to-normalized.ts
import { NormalizedStatement, NormalizedTxn } from "./types";
import {
  cleanBankName,
  cleanIdentifier,
  toISODate,
  normalizeAmount,
  normalizeCurrency,
  headerPointFrom,
  rowPointFrom,
  footerStatsFrom,
} from "./normalize";

// Exported so route.ts can type the mapper
export type InRow = {
  date?: string;
  description?: string;
  amount?: string;
  currency?: string;
};

type Meta = Partial<{
  bank: string;
  bank_account: string;
  customer_account_number: string;
  statement_date: string;
  opening_balance: string;
  closing_balance: string;
  currency: string; // header currency default (ISO or symbol)
}>;

function majorityIsoCurrency(rows: NormalizedTxn[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (/^[A-Z]{3}$/.test(r.currency)) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  }
  let best = "unknown", max = 0;
  for (const [cur, n] of counts) if (n > max) { max = n; best = cur; }
  return best;
}

/**
 * Convert loose rows + optional header meta into the normalized statement shape:
 * - Header: scrubbed identifiers, ISO dates, 2-decimal amounts, header row_point
 * - Transactions: per-row normalization + row_point
 * - Footer: { num_transactions, total_amount_parsed, balanced, doc_point }
 * - Currency precedence (row): txn → header → "unknown"
 */
export function rowsToNormalized(rows: InRow[], meta?: Meta): NormalizedStatement {
  // 1) Normalize each transaction row independently (first pass)
  let txns: NormalizedTxn[] = (rows ?? []).map((r) => {
    const date = toISODate(r.date ?? "unknown");
    const description = (r.description ?? "").trim() || "unknown";
    const amount = normalizeAmount(r.amount ?? "0");
    const txnCur = normalizeCurrency(r.currency ?? "");
    const currency = txnCur || "unknown";
    return {
      date,
      description,
      amount,
      currency,
      row_point: rowPointFrom({ date, description, amount, currency }),
    };
  });

  // 2) Header fields (scrubbed + normalized)
  const bank = cleanBankName(meta?.bank ?? "unknown");
  const bank_account = cleanIdentifier(meta?.bank_account ?? "unknown");
  const customer_account_number = cleanIdentifier(meta?.customer_account_number ?? bank_account ?? "unknown");
  const statement_date = toISODate(meta?.statement_date ?? "unknown");
  const opening_balance = normalizeAmount(meta?.opening_balance ?? "0");
  const closing_balance = normalizeAmount(meta?.closing_balance ?? "0");

  // 3) Header currency default
  const headerCurrencyExplicit = normalizeCurrency(meta?.currency ?? "");
  const headerCurrencyInferred = majorityIsoCurrency(txns);
  const headerCurrency = headerCurrencyExplicit || headerCurrencyInferred || "unknown";

  // 4) Apply currency precedence per row: txn → header → unknown (recompute row_point if changed)
  txns = txns.map((t) => {
    if (!/^[A-Z]{3}$/.test(t.currency)) {
      const cur = /^[A-Z]{3}$/.test(headerCurrency) ? headerCurrency : "unknown";
      const updated = { ...t, currency: cur };
      return { ...updated, row_point: rowPointFrom(updated) };
    }
    return t;
  });

  // 5) Build header with row_point
  const headerTmp = {
    bank,
    bank_account,
    customer_account_number,
    statement_date,
    opening_balance,
    closing_balance,
    currency: headerCurrency,
  };
  const header = { ...headerTmp, row_point: headerPointFrom(headerTmp) };

  // 6) Footer stats (num_transactions, total_amount_parsed, balanced, doc_point)
  const footer = footerStatsFrom(header, txns);

  return { header, transactions: txns, footer };
}
