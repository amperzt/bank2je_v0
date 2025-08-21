export default function HomePage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">CSV Parser Test</h1>
      <p className="text-muted-foreground">Use POST /api/test-csv with a CSV file to test the parser.</p>
      <div className="mt-4 p-4 bg-muted rounded-lg">
        <code className="text-sm">curl -X POST -F "file=@statement.csv" http://localhost:3000/api/test-csv</code>
      </div>
    </div>
  )
}
