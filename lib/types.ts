export type NormalizedAmount = string;     // "10000.50" or "-12.34"
export type ISODate = string;              // "YYYY-MM-DD"
export type ISOCurrency = string;          // "USD", "PHP", etc. or "unknown"

export type NormalizedHeader = {
  bank: string;                     // alphanumerics only
  bank_account: string;             // no dashes/spaces/specials
  customer_account_number: string;  // no dashes/spaces/specials
  statement_date: ISODate;          // YYYY-MM-DD
  opening_balance: NormalizedAmount;
  closing_balance: NormalizedAmount;
  currency: ISOCurrency;
  row_point: string;                // 5 decimals as string, e.g. "0.43210"
};

export type NormalizedTxn = {
  date: ISODate;                    // YYYY-MM-DD
  description: string;
  amount: NormalizedAmount;         // signed, 2dp, no commas, dot decimal
  currency: ISOCurrency;            // ISO or "unknown"
  row_point: string;                // 5 decimals
};

export type NormalizedFooter = {
  doc_point: string;                // 5 decimals
};

export type NormalizedStatement = {
  header: NormalizedHeader;
  transactions: NormalizedTxn[];
  footer: NormalizedFooter;
};
