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
  docPointFrom,
} from "./normalize";

type InRow = {
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
  currency: string; // default header currency (ISO or symbol); optional
}>;

// Pick the most frequent ISO currency from rows
function majorityIsoCurrency(rows: NormalizedTxn[]): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (/^[A-Z]{3}$/.test(r.currency)) {
      counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1);
    }
  }
  let best = "unknown";
  let max = 0;
  for (const [cur, n] of counts) {
    if (n > max) { max = n; best = cur; }
  }
  return best;
}

export function rowsToNormalized(rows: InRow[], meta?: Meta): NormalizedStatement {
  // Normalize each input row to our strict txn shape
  const txns: NormalizedTxn[] = (rows ?? []).map((r) => {
    const date = toISODate(r.date ?? "unknown");
    const description = (r.description ?? "").trim() || "unknown";
    const amount = normalizeAmount(r.amount ?? "0");
    const currency = normalizeCurrency(r.currency ?? "");
    return {
      date,
      description,
      amount,
      currency: currency || "unknown",
      row_point: rowPointFrom({ date, description, amount, currency: currency || "unknown" }),
    };
  });

  // Header fields (with required fallbacks)
  const bank = cleanBankName(meta?.bank ?? "unknown");
  const bank_account = cleanIdentifier(meta?.bank_account ?? "unknown");
  const customer_account_number = cleanIdentifier(
    meta?.customer_account_number ?? bank_account ?? "unknown"
  );
  const statement_date = toISODate(meta?.statement_date ?? "unknown");

  const opening_balance = normalizeAmount(meta?.opening_balance ?? "0");
  const closing_balance = normalizeAmount(meta?.closing_balance ?? "0");

  // Currency for header: prefer explicit meta; else majority currency from rows; else unknown
  const headerCurrencyExplicit = normalizeCurrency(meta?.currency ?? "");
  const headerCurrencyInferred = majorityIsoCurrency(txns);
  const headerCurrency = headerCurrencyExplicit || headerCurrencyInferred || "unknown";

  // Finalize header + header row point
  const headerTmp = {
    bank,
    bank_account,
    customer_account_number,
    statement_date,
    opening_balance,
    closing_balance,
    currency: headerCurrency,
  };
  const header = {
    ...headerTmp,
    row_point: headerPointFrom(headerTmp),
  };

  // If some transactions have unknown currency, fill them from header currency
  for (const t of txns) {
    if (!/^[A-Z]{3}$/.test(t.currency) && /^[A-Z]{3}$/.test(header.currency)) {
      t.currency = header.currency;
      t.row_point = rowPointFrom({
        date: t.date,
        description: t.description,
        amount: t.amount,
        currency: t.currency,
      });
    }
  }

  // Doc-level point
  const footer = {
    doc_point: docPointFrom(header, txns),
  };

  return { header, transactions: txns, footer };
}
