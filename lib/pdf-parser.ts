import { getDocument } from "pdfjs-dist/legacy/build/pdf"
import { createWorker } from "tesseract.js"
import type { ParsedStatement, PDFType, Txn, StatementHeader } from "./types"
import type { ImageData } from "canvas"

export async function parsePdf(buffer: Buffer): Promise<ParsedStatement> {
  try {
    const pdfType = await detectPdfType(buffer)

    if (pdfType === "unreadable") {
      throw new Error("Bank statement unreadable. Use a different bank statement format or upload a clearer image.")
    }

    let textContent: string
    if (pdfType === "text") {
      textContent = await extractTextFromPdf(buffer)
    } else {
      textContent = await extractTextWithOCR(buffer)
    }

    return parseStatementText(textContent)
  } catch (error) {
    console.error("[v0] PDF parsing failed:", error)
    throw error
  }
}

async function detectPdfType(buffer: Buffer): Promise<PDFType> {
  try {
    const pdf = await getDocument({ data: buffer }).promise
    const page = await pdf.getPage(1)
    const textContent = await page.getTextContent()

    const text = textContent.items
      .map((item: any) => item.str)
      .join(" ")
      .trim()

    // If we can extract meaningful text, it's text-based
    if (text.length > 100 && /\d/.test(text)) {
      return "text"
    }

    // If minimal text but PDF loads, it's likely scanned
    return "scanned"
  } catch (error) {
    return "unreadable"
  }
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdf = await getDocument({ data: buffer }).promise
  let fullText = ""

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const textContent = await page.getTextContent()

    const items = textContent.items as any[]

    // Sort items by Y position (top to bottom) then X position (left to right)
    items.sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5] // Y coordinate (inverted)
      if (Math.abs(yDiff) > 5) return yDiff > 0 ? 1 : -1 // Different lines
      return a.transform[4] - b.transform[4] // Same line, sort by X
    })

    let currentY = items[0]?.transform[5]
    let lineText = ""

    for (const item of items) {
      const itemY = item.transform[5]

      // If Y position changed significantly, we're on a new line
      if (Math.abs(currentY - itemY) > 5) {
        if (lineText.trim()) {
          fullText += lineText.trim() + "\n"
        }
        lineText = item.str
        currentY = itemY
      } else {
        // Same line, add space if needed
        if (lineText && !lineText.endsWith(" ") && !item.str.startsWith(" ")) {
          lineText += " "
        }
        lineText += item.str
      }
    }

    // Add the last line
    if (lineText.trim()) {
      fullText += lineText.trim() + "\n"
    }
  }

  console.log("[v0] Extracted PDF text:", fullText.substring(0, 500) + "...")
  return fullText
}

async function extractTextWithOCR(buffer: Buffer): Promise<string> {
  try {
    console.log("[v0] Starting OCR extraction...")

    // Convert PDF to images first
    const images = await convertPdfToImages(buffer)

    // Initialize Tesseract worker
    const worker = await createWorker("eng")

    let fullText = ""

    // Process each page image with OCR
    for (let i = 0; i < images.length; i++) {
      console.log(`[v0] Processing page ${i + 1} with OCR...`)

      const {
        data: { text },
      } = await worker.recognize(images[i])
      fullText += text + "\n"
    }

    await worker.terminate()

    console.log("[v0] OCR extraction completed")
    return fullText
  } catch (error) {
    console.error("[v0] OCR extraction failed:", error)
    throw new Error("OCR processing failed. The scanned document may be too unclear to read.")
  }
}

async function convertPdfToImages(buffer: Buffer): Promise<ImageData[]> {
  const pdf = await getDocument({ data: buffer }).promise
  const images: ImageData[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2.0 }) // Higher scale for better OCR

    // Create canvas
    const canvas = new OffscreenCanvas(viewport.width, viewport.height)
    const context = canvas.getContext("2d")

    if (!context) {
      throw new Error("Could not create canvas context for PDF rendering")
    }

    // Render page to canvas
    await page.render({
      canvasContext: context as any,
      viewport: viewport,
    }).promise

    // Get image data
    const imageData = context.getImageData(0, 0, viewport.width, viewport.height)
    images.push(imageData)
  }

  return images
}

function parseStatementText(text: string): ParsedStatement {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line)

  const header = extractHeaderInfo(lines)
  const transactions = extractTransactions(lines)
  const documentScore = calculateDocumentScore(header, transactions)

  return {
    header: { ...header, rowScore: calculateHeaderScore(header) },
    transactions: transactions.map((txn) => ({
      ...txn,
      rowScore: calculateTransactionScore(txn),
    })),
    documentScore,
  }
}

function extractHeaderInfo(lines: string[]): StatementHeader {
  const header: StatementHeader = {
    bank: "unknown",
    bankAccount: "unknown",
    customerAccount: "unknown",
    statementDate: "unknown",
    openingBalance: "0",
    closingBalance: "0",
    rowScore: 0,
  }

  console.log("[v0] Processing header from lines:", lines.slice(0, 15))

  for (let i = 0; i < Math.min(15, lines.length); i++) {
    const line = lines[i]
    const lowerLine = line.toLowerCase()

    if (
      (lowerLine.includes("bank") || lowerLine.includes("credit card")) &&
      lowerLine.includes("statement") &&
      header.bank === "unknown"
    ) {
      header.bank = line.replace(/\s+/g, " ").trim()
    }

    if ((lowerLine.includes("account") && /[*x\d]{4,}/.test(line)) || lowerLine.includes("account no")) {
      const accountMatch = line.match(/[*x\d-]{4,}/i)
      if (accountMatch) {
        header.customerAccount = accountMatch[0]
      }
    }

    if (lowerLine.includes("statement") && lowerLine.includes("date")) {
      const dateMatch = line.match(/\d{4}-\d{2}-\d{2}|\w{3}\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}/)
      if (dateMatch) {
        header.statementDate = normalizeDate(dateMatch[0])
      }
    }

    if (lowerLine.includes("opening") && /[$\d.,$$$$]+/.test(line)) {
      const balanceMatch = line.match(/\$?[\d,]+\.\d{2}/)
      if (balanceMatch) {
        header.openingBalance = balanceMatch[0].replace("$", "")
      }
    }

    if (lowerLine.includes("closing") && /[$\d.,$$$$]+/.test(line)) {
      const balanceMatch = line.match(/\$?[\d,]+\.\d{2}/)
      if (balanceMatch) {
        header.closingBalance = balanceMatch[0].replace("$", "")
      }
    }
  }

  console.log("[v0] Extracted header:", header)
  return header
}

function extractTransactions(lines: string[]): Txn[] {
  const transactions: Txn[] = []
  const currency = detectCurrency(lines.join(" "))

  console.log("[v0] Processing transactions from", lines.length, "lines")

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Skip obvious header lines
    if (isHeaderLine(line)) continue

    const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/)
    if (!dateMatch) continue

    const amountMatch = line.match(/\$?[\d,]+\.\d{2}|$$[\d,]+\.\d{2}$$/)
    if (!amountMatch) continue

    const date = normalizeDate(dateMatch[0])
    const amount = normalizeAmount(amountMatch[0])

    const dateIndex = line.indexOf(dateMatch[0])
    const amountIndex = line.indexOf(amountMatch[0])

    let description = ""
    if (dateIndex < amountIndex) {
      // Description is between date and amount
      description = line.substring(dateIndex + dateMatch[0].length, amountIndex).trim()
    } else {
      // Description might be before date or after amount
      const beforeDate = line.substring(0, dateIndex).trim()
      const afterAmount = line.substring(amountIndex + amountMatch[0].length).trim()
      description = beforeDate || afterAmount
    }

    if (description.length >= 3) {
      transactions.push({
        date,
        description: mergeMultilineDescription(description),
        amount,
        currency,
        rowScore: 0,
      })
    }
  }

  console.log("[v0] Extracted", transactions.length, "transactions")
  return transactions
}

function detectCurrency(text: string): string {
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

function isHeaderLine(line: string): boolean {
  const headerKeywords = [
    "statement",
    "account",
    "balance",
    "total",
    "summary",
    "date",
    "description",
    "amount",
    "debit",
    "credit",
  ]

  const lowerLine = line.toLowerCase()
  return headerKeywords.some((keyword) => lowerLine.includes(keyword)) && !line.match(/\d{4}-\d{2}-\d{2}/) // But has no date
}

function normalizeDate(dateStr: string): string {
  const cleanDate = dateStr.replace(/[^\d/\-.]/g, "")

  if (/^\d{4}-\d{2}-\d{2}$/.test(cleanDate)) {
    return cleanDate
  }

  if (/^\d{1,2}[/\-.]\d{1,2}[/\-.]\d{4}$/.test(cleanDate)) {
    const parts = cleanDate.split(/[/\-.]/)
    const date = new Date(Number.parseInt(parts[2]), Number.parseInt(parts[0]) - 1, Number.parseInt(parts[1]))

    if (!isNaN(date.getTime())) {
      return date.toISOString().split("T")[0]
    }
  }

  return ""
}

function normalizeAmount(amountStr: string): string {
  console.log("[v0] Normalizing amount:", amountStr)

  const isNegative = (amountStr.includes("(") && amountStr.includes(")")) || amountStr.startsWith("-")

  // Extract numeric value, removing currency symbols and parentheses
  const numericStr = amountStr.replace(/[$$$$$]/g, "").replace(/[^\d.,]/g, "")
  const amount = Number.parseFloat(numericStr.replace(/,/g, ""))

  if (isNaN(amount)) return "0.00"

  const finalAmount = isNegative ? -amount : amount
  const result = finalAmount.toFixed(2)
  console.log("[v0] Normalized amount result:", result)
  return result
}

function mergeMultilineDescription(description: string): string {
  // Clean up and merge description text
  return description
    .replace(/\s+/g, " ")
    .replace(/[^\w\s\-.]/g, " ")
    .trim()
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
  if (header.openingBalance !== "0" && header.closingBalance !== "0") {
    const opening = Number.parseFloat(header.openingBalance.replace(/,/g, ""))
    const closing = Number.parseFloat(header.closingBalance.replace(/,/g, ""))
    const transactionSum = transactions.reduce((sum, txn) => sum + Number.parseFloat(txn.amount), 0)

    if (Math.abs(opening + transactionSum - closing) < 0.01) {
      documentScore += 0.1
    }
  }

  // Round to 5 decimal places
  return Math.round(documentScore * 100000) / 100000
}
