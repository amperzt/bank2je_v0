import { type NextRequest, NextResponse } from "next/server"
import { parseCsv } from "@/lib/csv-parser"
import { parsePdf } from "@/lib/pdf-parser"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get("file") as File

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const fileType = getFileType(file.name)

    let parsedStatement

    switch (fileType) {
      case "csv":
        parsedStatement = parseCsv(buffer)
        break
      case "pdf":
        parsedStatement = await parsePdf(buffer)
        break
      case "xlsx":
        // TODO: Implement XLSX parser
        return NextResponse.json({ error: "XLSX parsing not yet implemented" }, { status: 501 })
      default:
        return NextResponse.json({ error: "Unsupported file type" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      count: parsedStatement.transactions.length,
      data: parsedStatement,
    })
  } catch (error) {
    console.error("Statement parsing error:", error)
    return NextResponse.json(
      {
        error: "Failed to parse statement",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    )
  }
}

function getFileType(filename: string): "csv" | "pdf" | "xlsx" | "unknown" {
  const extension = filename.toLowerCase().split(".").pop()

  switch (extension) {
    case "csv":
      return "csv"
    case "pdf":
      return "pdf"
    case "xlsx":
    case "xls":
      return "xlsx"
    default:
      return "unknown"
  }
}
