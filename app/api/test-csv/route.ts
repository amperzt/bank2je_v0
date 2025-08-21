import { type NextRequest, NextResponse } from "next/server"
import { parseCsv } from "@/lib/csv-parser"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const transactions = parseCsv(buffer)

    return NextResponse.json({
      success: true,
      count: transactions.length,
      transactions,
    })
  } catch (error) {
    console.error("CSV parsing error:", error)
    return NextResponse.json(
      {
        error: "Failed to parse CSV",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}
