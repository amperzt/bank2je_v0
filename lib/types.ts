export type Txn = {
  date: string // ISO yyyy-mm-dd
  description: string
  amount: string // as string, will be parsed later
  currency: string // ISO code like USD, EUR, PHP
  rowScore: number // validation score for this transaction
}

export type StatementHeader = {
  bank: string // Required field, default "unknown"
  bankAccount: string // Required field, default "unknown"
  customerAccount: string // Required field, default "unknown"
  statementDate: string // Required field, default "unknown"
  openingBalance: string // Required field, default "0"
  closingBalance: string // Required field, default "0"
  rowScore: number // validation score for header data
}

export type ParsedStatement = {
  header: StatementHeader
  transactions: Txn[]
  documentScore: number // overall document validation score
}

export type FileType = "csv" | "pdf" | "xlsx"

export type PDFType = "text" | "scanned" | "unreadable"
