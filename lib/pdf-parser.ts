// lib/pdf-parser.ts
// Unified PDF text extraction with two fallbacks:
// 1) pdf-parse (fast path)
// 2) pdfjs-dist (loaded via file URL from node_modules, robust path resolver)

import { existsSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";

export type PdfParseResult = { text?: string; warnings?: string[] };

export async function parsePdfSmart(buf: Buffer): Promise<PdfParseResult> {
  const warnings: string[] = [];

  // ---------- Fast path: pdf-parse ----------
  try {
    // Import the internal lib entry to avoid the self-test in index.js
    const mod = await import("pdf-parse/lib/pdf-parse.js");
    const pdfParse: (b: Buffer | Uint8Array) => Promise<{ text?: string }> =
      (mod as any).default ?? (mod as any);
    if (typeof pdfParse !== "function") throw new Error("pdf-parse export not a function");

    const data = await pdfParse(buf);
    const text = (data?.text || "").trim();
    if (text && text.replace(/\s+/g, "").length >= 50) {
      return { text, warnings };
    }
    warnings.push("Low text from pdf-parse; using pdfjs-dist fallback.");
  } catch (e: any) {
    warnings.push(`pdf-parse failed: ${e?.message ?? String(e)}`);
  }

  // ---------- Fallback: pdfjs-dist via real file path ----------
  try {
    // Resolve the base directory of pdfjs-dist in node_modules
    const pkgJsonPath = require.resolve("pdfjs-dist/package.json");
    const baseDir = dirname(pkgJsonPath);

    // Try multiple known layouts; pick the first that exists on disk
    const moduleRelPaths = [
      "legacy/build/pdf.mjs",
      "build/pdf.mjs",
      "legacy/build/pdf.js",
      "build/pdf.js",
    ];
    const workerRelPaths = [
      "legacy/build/pdf.worker.mjs",
      "build/pdf.worker.mjs",
      "legacy/build/pdf.worker.js",
      "build/pdf.worker.js",
    ];

    const modulePath = moduleRelPaths
      .map((p) => join(baseDir, p))
      .find((full) => existsSync(full));
    if (!modulePath) throw new Error("Could not find pdf.js module file on disk");

    const workerPath = workerRelPaths
      .map((p) => join(baseDir, p))
      .find((full) => existsSync(full));

    // Import the module from a file:// URL to bypass package exports
    const m: any = await import(pathToFileURL(modulePath).href);

    const getDocument = m.getDocument ?? m.default?.getDocument;
    const GlobalWorkerOptions = m.GlobalWorkerOptions ?? m.default?.GlobalWorkerOptions;
    if (!getDocument || !GlobalWorkerOptions) {
      throw new Error("pdfjs-dist loaded but missing getDocument/GlobalWorkerOptions");
    }

    if (workerPath) {
      GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    }

    const task = getDocument({
      data: new Uint8Array(buf),
      isEvalSupported: false,
      useWorkerFetch: false,
    });

    const pdf = await task.promise;
    let out = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      out += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
    }
    await pdf.destroy();

    const text = out.trim();
    if (!text || text.replace(/\s+/g, "").length < 50) {
      warnings.push("PDF has little/no extractable text (likely scanned). OCR fallback not implemented yet.");
    }
    return { text, warnings };
  } catch (e: any) {
    warnings.push(`pdfjs-dist failed: ${e?.message ?? String(e)}`);
    // surface both errors
    throw new Error(warnings.join(" | "));
  }
}
