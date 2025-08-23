# bank2je

Normalize bank statements from CSV, XLSX, and PDF into a single JSON schema.

## Features
- CSV/XLSX/PDF ingestion (Node runtime)
- Robust PDF text extraction (pdf-parse ➜ pdf.js fallback)
- Normalization:
  - Dates → `YYYY-MM-DD`
  - Amounts → signed numeric strings, 2 decimals, no commas/symbols
  - Currency → ISO code (or `"unknown"`)
  - Identifiers scrubbed (no spaces/dashes/specials)
- Scoring:
  - `row_point` (per transaction, 5 decimals)
  - `header.row_point` (header quality, 5 decimals)
  - `footer.doc_point` (roll-up with coverage penalties, 5 decimals)

## Dev
```bash
npm install
npm run dev
