// IMPORTANT: do not import pdfjs-dist at module scope inside an API route file
// This file itself is safe to import, because we only import pdfjs *inside* the function.

export type PdfParseResult = {
  text?: string;
  rows?: Array<{ date: string; description: string; amount: string; currency?: string }>;
  warnings?: string[];
};

export async function parsePdfSmart(buf: Buffer): Promise<PdfParseResult> {
  // lazy load here
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { getDocument, GlobalWorkerOptions } = pdfjs as any;
  // In Node, avoid external worker URLs; use bundled worker or disable eval
  GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");

  const data = new Uint8Array(buf); // ✅ critical: pdf.js wants Uint8Array

  const loadingTask = getDocument({
    data,
    isEvalSupported: false,
    useWorkerFetch: false,
  });

  const pdf = await loadingTask.promise;
  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await pdf.destroy();

  // TODO: detect scanned (out.length tiny) -> OCR fallback (optional)
  // TODO: parse `out` into rows/meta per your rules; for now we return text
  return { text: out.trim() };
}
