"use client"

import type React from "react"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface ParsedResult {
  success: boolean
  count: number
  data: {
    header: {
      bank: string
      bankAccount: string
      customerAccount: string
      statementDate: string
      openingBalance: string
      closingBalance: string
      rowScore: number
    }
    transactions: Array<{
      date: string
      description: string
      amount: string
      currency: string
      rowScore: number
    }>
    documentScore: number
  }
  error?: string
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ParsedResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setResult(null)
      setError(null)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) return

    setLoading(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append("file", file)

      const response = await fetch("/api/parse-statement", {
        method: "POST",
        body: formData,
      })

      const data = await response.json()

      if (response.ok) {
        setResult(data)
      } else {
        setError(data.error || "Failed to parse file")
      }
    } catch (err) {
      setError("Network error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Statement Parser</h1>
        <p className="text-muted-foreground">Upload CSV, PDF, or XLSX bank statements to extract transaction data</p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Upload Statement</CardTitle>
          <CardDescription>Supported formats: CSV, PDF, XLSX</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="file">Select File</Label>
              <Input id="file" type="file" accept=".csv,.pdf,.xlsx" onChange={handleFileChange} className="mt-1" />
            </div>
            <Button type="submit" disabled={!file || loading}>
              {loading ? "Parsing..." : "Parse Statement"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <Alert className="mb-6">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {result && (
        <div className="space-y-6">
          {/* Header Information */}
          <Card>
            <CardHeader>
              <CardTitle>Statement Information</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="font-medium">Bank:</span>
                  <p className="text-muted-foreground">{result.data.header.bank}</p>
                </div>
                <div>
                  <span className="font-medium">Account:</span>
                  <p className="text-muted-foreground">{result.data.header.customerAccount}</p>
                </div>
                <div>
                  <span className="font-medium">Statement Date:</span>
                  <p className="text-muted-foreground">{result.data.header.statementDate}</p>
                </div>
                <div>
                  <span className="font-medium">Opening Balance:</span>
                  <p className="text-muted-foreground">{result.data.header.openingBalance}</p>
                </div>
                <div>
                  <span className="font-medium">Closing Balance:</span>
                  <p className="text-muted-foreground">{result.data.header.closingBalance}</p>
                </div>
                <div>
                  <span className="font-medium">Document Score:</span>
                  <p className="text-muted-foreground">{result.data.documentScore.toFixed(5)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Transaction Summary */}
          <Card>
            <CardHeader>
              <CardTitle>Transaction Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg">
                <span className="font-medium">Total Transactions:</span> {result.count}
              </p>
            </CardContent>
          </Card>

          {/* Transactions Table */}
          {result.data.transactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse border border-border">
                    <thead>
                      <tr className="bg-muted">
                        <th className="border border-border p-2 text-left">Date</th>
                        <th className="border border-border p-2 text-left">Description</th>
                        <th className="border border-border p-2 text-right">Amount</th>
                        <th className="border border-border p-2 text-center">Currency</th>
                        <th className="border border-border p-2 text-center">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.data.transactions.map((transaction, index) => (
                        <tr key={index} className="hover:bg-muted/50">
                          <td className="border border-border p-2">{transaction.date}</td>
                          <td className="border border-border p-2">{transaction.description}</td>
                          <td className="border border-border p-2 text-right font-mono">{transaction.amount}</td>
                          <td className="border border-border p-2 text-center">{transaction.currency}</td>
                          <td className="border border-border p-2 text-center">{transaction.rowScore}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Raw JSON Output */}
          <Card>
            <CardHeader>
              <CardTitle>Raw JSON Response</CardTitle>
              <CardDescription>Complete API response for debugging</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-lg overflow-x-auto text-sm">
                <code>{JSON.stringify(result, null, 2)}</code>
              </pre>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
