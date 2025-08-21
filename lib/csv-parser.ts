import { parse } from "csv-parse/sync"
import type { ParsedStatement, Txn, StatementHeader } from "./types" // Assuming Txn and StatementHeader are declared in a separate file

export function parseCsv(buffer: Buffer): ParsedStatement {
  const content = buffer.toString("utf-8")
  const delimiter = detectDelimiter(content)

  let records: string[][]
  try {
    records = parse(content, {
      delimiter,
      skip_empty_lines: true,
      trim: true,
    })
  } catch (error) {
    console.log("[v0] CSV parsing failed:", error)
    return createEmptyStatement()
  }

  if (records.length === 0) {
    return createEmptyStatement()
  }

  const hasHeader = isHeaderRow(records[0])
  const dataRows = hasHeader ? records.slice(1) : records

  console.log("[v0] Detected delimiter:", delimiter)
  console.log("[v0] Has header:", hasHeader)
  console.log("[v0] First few records:", records.slice(0, 3))

  const transactions = dataRows
    .map((row) => {
      if (row.length < 3) {
        console.log("[v0] Skipping row with insufficient columns:", row)
        return null
      }

      const [dateStr, description, amountStr] = row
      const currency = detectCurrencyFromRow(row.join(" "))

      return {
        date: normalizeDate(dateStr?.trim() || ""),
        description: description?.trim() || "",
        amount: normalizeAmount(amountStr?.trim() || "0"),
        currency,
        rowScore: 0, // Will be calculated later
      }
    })
    .filter((txn): txn is Txn => txn !== null && txn.date && txn.description)

  const header: StatementHeader = {
    bank: "unknown",
    bankAccount: "unknown",
    customerAccount: "unknown",
    statementDate: "unknown",
    openingBalance: "0",
    closingBalance: "0",
    rowScore: 0,
  }

  // Calculate scores
  const scoredTransactions = transactions.map((txn) => ({
    ...txn,
    rowScore: calculateTransactionScore(txn),
  }))

  const scoredHeader = {
    ...header,
    rowScore: calculateHeaderScore(header),
  }

  const documentScore = Math.round(calculateDocumentScore(scoredHeader, scoredTransactions) * 100000) / 100000

  return {
    header: scoredHeader,
    transactions: scoredTransactions,
    documentScore,
  }
}

function createEmptyStatement(): ParsedStatement {
  return {
    header: {
      bank: "unknown",
      bankAccount: "unknown",
      customerAccount: "unknown",
      statementDate: "unknown",
      openingBalance: "0",
      closingBalance: "0",
      rowScore: 0,
    },
    transactions: [],
    documentScore: 0,
  }
}

function detectCurrencyFromRow(text: string): string {
  const currencyPatterns = [
    { pattern: /\$|USD|US\s*Dollar/i, code: "USD" },
    { pattern: /€|EUR|Euro/i, code: "EUR" },
    { pattern: /£|GBP|Pound/i, code: "GBP" },
    { pattern: /₱|PHP|Peso/i, code: "PHP" },
    { pattern: /S\$|SGD|Singapore/i, code: "SGD" },
  ]

  for (const { pattern, code } of currencyPatterns) {
    if (pattern.test(text)) {
      return code
    }
  }

  return "USD" // Default fallback
}

function normalizeAmount(amountStr: string): string {
  // Handle parentheses for negative amounts
  const isNegative = amountStr.includes("(") || amountStr.startsWith("-")

  // Extract numeric value
  const numericStr = amountStr.replace(/[^\d.,]/g, "")
  const amount = Number.parseFloat(numericStr.replace(/,/g, ""))

  if (isNaN(amount)) return "0.00"

  const finalAmount = isNegative ? -amount : amount
  return finalAmount.toFixed(2)
}

function calculateTransactionScore(txn: Txn): number {
  let score = 0

  // Valid date parsed → +0.5
  if (txn.date && /^\d{4}-\d{2}-\d{2}$/.test(txn.date)) {
    score += 0.5
  }

  // Valid amount parsed → +0.4
  if (txn.amount && !isNaN(Number.parseFloat(txn.amount))) {
    score += 0.4
  }

  // Description has ≥ 3 tokens → +0.1
  if (txn.description && txn.description.split(" ").length >= 3) {
    score += 0.1
  }

  return score
}

function calculateHeaderScore(header: StatementHeader): number {
  let score = 0

  // Valid bank, bank account number OR customer account parsed → 0.5
  if (header.bank || header.bankAccount || header.customerAccount) {
    score += 0.5
  }

  // Valid statement date parsed → 0.1
  if (header.statementDate) {
    score += 0.1
  }

  // Valid opening balance parsed → 0.2
  if (header.openingBalance) {
    score += 0.2
  }

  // Valid ending balance parsed → 0.2
  if (header.closingBalance) {
    score += 0.2
  }

  return score
}

function calculateDocumentScore(header: StatementHeader, transactions: Txn[]): number {
  // Get mean of all row points
  const allScores = [header.rowScore, ...transactions.map((t) => t.rowScore)]
  const meanScore = allScores.reduce((sum, score) => sum + score, 0) / allScores.length

  let documentScore = meanScore

  // Check if opening balance + sum of transactions = ending balance → add 0.1
  if (header.openingBalance && header.closingBalance) {
    const opening = Number.parseFloat(header.openingBalance.replace(/,/g, ""))
    const closing = Number.parseFloat(header.closingBalance.replace(/,/g, ""))
    const transactionSum = transactions.reduce((sum, txn) => sum + Number.parseFloat(txn.amount), 0)

    if (Math.abs(opening + transactionSum - closing) < 0.01) {
      documentScore += 0.1
    }
  }

  return documentScore
}

function detectDelimiter(content: string): string {
  const lines = content.split("\n").slice(0, 5) // Check first 5 lines

  let commaCount = 0
  let semicolonCount = 0

  for (const line of lines) {
    if (line.trim()) {
      commaCount += (line.match(/,/g) || []).length
      semicolonCount += (line.match(/;/g) || []).length
    }
  }

  console.log("[v0] Comma count:", commaCount, "Semicolon count:", semicolonCount)

  // Return the delimiter that appears more frequently
  return semicolonCount > commaCount ? ";" : ","
}

function isHeaderRow(row: string[]): boolean {
  if (!row || row.length === 0) return false

  const firstCell = row[0]?.toLowerCase().trim()

  const headerKeywords = [
    "date",
    "transaction",
    "description",
    "amount",
    "debit",
    "credit",
    "txn",
    "details",
    "amt",
    "posting",
    "reference",
  ]

  return headerKeywords.some((keyword) => firstCell?.includes(keyword))
}

function normalizeDate(dateStr: string): string {
  if (!dateStr) return ""

  // Handle common date formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, etc.
  const cleanDate = dateStr.replace(/[^\d/\-.]/g, "")

  // Try to parse various formats
  let date: Date | null = null

  // YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    date = new Date(cleanDate)
  }
  // MM/DD/YYYY or DD/MM/YYYY format
  else if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(cleanDate)) {
    const parts = cleanDate.split(/[/\-.]/)
    // Assume MM/DD/YYYY for US format (most credit card statements)
    date = new Date(Number.parseInt(parts[2]), Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]))
  }
  // DD/MM/YYYY format (try if first attempt seems wrong)
  else if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(cleanDate)) {
    const parts = cleanDate.split(/[/\-.]/)
    const mmddyyyy = new Date(Number.parseInt(parts[2]), Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]))
    const ddmmyyyy = new Date(Number.parseInt(parts[2]), Number.parseInt(parts[1]) - 1, Number.parseInt(parts[0]))

    // Use the date that makes more sense (not in future, valid month/day)
    date = mmddyyyy.getTime() > Date.now() ? ddmmyyyy : mmddyyyy
  }

  if (!date || isNaN(date.getTime())) {
    return ""
  }

  // Return in ISO format (YYYY-MM-DD)
  return date.toISOString().split("T")[0]
}
