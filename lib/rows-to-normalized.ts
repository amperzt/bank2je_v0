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
  sumAmounts         
} from "./normalize";


type InRow = { date?: string; description?: string; amount?: string; currency?: string; };
type Meta = Partial<{
  bank: string; bank_account: string; customer_account_number: string;
  statement_date: string; opening_balance: string; closing_balance: string;
  currency: string;
}>;

function majorityIsoCurrency(rows: NormalizedTxn[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) if (/^[A-Z]{3}$/.test(r.currency)) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
  let best = "unknown", max = 0;
  for (const [cur, n] of counts) if (n > max) { max = n; best = cur; }
  return best;
}

export function rowsToNormalized(rows: InRow[], meta?: Meta): NormalizedStatement {
  // First pass: normalize each row independently
  let txns: NormalizedTxn[] = (rows ?? []).map((r) => {
    const date = toISODate(r.date ?? "unknown");
    const description = (r.description ?? "").trim() || "unknown";
    const amount = normalizeAmount(r.amount ?? "0");
    // txn currency first (from cell), ISO or symbol
    const txnCur = normalizeCurrency(r.currency ?? "");
    const currency = txnCur || "unknown";
    return { date, description, amount, currency, row_point: rowPointFrom({ date, description, amount, currency }) };
  });

  // Header fields
  const bank = cleanBankName(meta?.bank ?? "unknown");
  const bank_account = cleanIdentifier(meta?.bank_account ?? "unknown");
  const customer_account_number = cleanIdentifier(meta?.customer_account_number ?? bank_account ?? "unknown");
  const statement_date = toISODate(meta?.statement_date ?? "unknown");
  const opening_balance = normalizeAmount(meta?.opening_balance ?? "0");
  const closing_balance = normalizeAmount(meta?.closing_balance ?? "0");

  // Header currency default
  const headerCurrencyExplicit = normalizeCurrency(meta?.currency ?? "");
  const headerCurrencyInferred = majorityIsoCurrency(txns);
  const headerCurrency = headerCurrencyExplicit || headerCurrencyInferred || "unknown";

  // Apply currency hierarchy per row: txn → header → unknown (don’t overwrite if row already has ISO)
  txns = txns.map(t => {
    if (!/^[A-Z]{3}$/.test(t.currency)) {
      const cur = /^[A-Z]{3}$/.test(headerCurrency) ? headerCurrency : "unknown";
      const updated = { ...t, currency: cur };
      return { ...updated, row_point: rowPointFrom(updated) };
    }
    return t;
  });

  // Header + points
  const headerTmp = { bank, bank_account, customer_account_number, statement_date, opening_balance, closing_balance, currency: headerCurrency };
  const header = { ...headerTmp, row_point: headerPointFrom(headerTmp) };

  // Footer totals
  const total_amount_parsed = sumAmounts(txns.map(t => t.amount));
  const num_transactions = txns.length;

  const footer = footerStatsFrom(header, txns);

  return { header, transactions: txns, footer };

}
