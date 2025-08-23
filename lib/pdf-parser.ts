// lib/pdf-parser.ts
import { existsSync } from "fs";
import { dirname, join } from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";

export type PdfParseResult = { text?: string; warnings?: string[] };

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (!x) return [];
  return Array.isArray(x) ? x : [x];
}

// Resolve pdfjs-dist real files from node_modules, not webpack's virtual "(rsc)/..." paths
function resolvePdfJsPaths() {
  const nodeRequire = createRequire(process.cwd() + "/package.json");
  const pkgJsonPath = nodeRequire.resolve("pdfjs-dist/package.json");
  const baseDir = dirname(pkgJsonPath);

  const moduleRel = ["build/pdf.mjs", "legacy/build/pdf.mjs", "build/pdf.js", "legacy/build/pdf.js"];
  const workerRel = ["build/pdf.worker.mjs", "legacy/build/pdf.worker.mjs", "build/pdf.worker.js", "legacy/build/pdf.worker.js"];

  const triedMods: string[] = [];
  let modulePath = "";
  for (const rel of moduleRel) {
    const p = join(baseDir, rel);
    triedMods.push(p);
    if (existsSync(p)) { modulePath = p; break; }
  }
  if (!modulePath) {
    throw new Error(`Could not find pdf.js module file on disk. baseDir=${baseDir} tried=[${triedMods.join(", ")}]`);
  }

  let workerPath = "";
  for (const rel of workerRel) {
    const p = join(baseDir, rel);
    if (existsSync(p)) { workerPath = p; break; }
  }

  return { baseDir, modulePath, workerPath };
}

async function extractWithPdfJs(buf: Buffer): Promise<string> {
  const { modulePath, workerPath } = resolvePdfJsPaths();
  const m: any = await import(pathToFileURL(modulePath).href);

  const getDocument = m.getDocument ?? m.default?.getDocument;
  const GlobalWorkerOptions = m.GlobalWorkerOptions ?? m.default?.GlobalWorkerOptions;
  if (!getDocument || !GlobalWorkerOptions) throw new Error("pdfjs-dist missing getDocument/GlobalWorkerOptions");
  if (workerPath) GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const task = getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useWorkerFetch: false });
  const pdf = await task.promise;

  let out = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    out += content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await pdf.destroy();
  return out.trim();
}

// Render PDF pages to PNG buffers using node-canvas (via pdf.js), then OCR each
async function ocrWithTesseract(buf: Buffer): Promise<{ text: string; warnings: string[] }> {
  const warnings: string[] = [];
  const { modulePath, workerPath } = resolvePdfJsPaths();
  const m: any = await import(pathToFileURL(modulePath).href);
  const { createCanvas } = await import("canvas");
  const Tesseract = await import("tesseract.js");

  const getDocument = m.getDocument ?? m.default?.getDocument;
  const GlobalWorkerOptions = m.GlobalWorkerOptions ?? m.default?.GlobalWorkerOptions;
  if (!getDocument || !GlobalWorkerOptions) throw new Error("pdfjs-dist missing getDocument/GlobalWorkerOptions");
  if (workerPath) GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;

  const task = getDocument({ data: new Uint8Array(buf), isEvalSupported: false, useWorkerFetch: false });
  const pdf = await task.promise;

  // Create worker (types differ across versions; treat as any and feature-detect)
  const worker: any = await (Tesseract as any).createWorker();

  // v5 style: loadLanguage + initialize
  if (typeof worker.loadLanguage === "function" && typeof worker.initialize === "function") {
    await worker.loadLanguage("eng");
    await worker.initialize("eng");
  }
  // v6 style: reinitialize
  else if (typeof worker.reinitialize === "function") {
    await worker.reinitialize("eng");
  }
  // else: some builds auto-init; proceed

  const SCALE = 2.0;
  let fullText = "";

  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const ctx = canvas.getContext("2d") as any;

      const renderTask = page.render({ canvasContext: ctx, viewport, intent: "print" });
      await renderTask.promise;

      const png = canvas.toBuffer("image/png");
      const result = await worker.recognize(png);
      fullText += ((result?.data?.text as string) || "") + "\n";
    }
  } finally {
    await pdf.destroy();
    await worker.terminate?.();
  }

  fullText = fullText.trim();
  if (!fullText) warnings.push("OCR produced no text.");
  else warnings.push("OCR used (tesseract.js).");

  return { text: fullText, warnings };
}

export async function parsePdfSmart(buf: Buffer): Promise<PdfParseResult> {
  const warnings: string[] = [];

  // 1) Fast path: pdf-parse (good for clean digital PDFs)
  try {
    const mod = await import("pdf-parse/lib/pdf-parse.js"); // avoids self-test in index.js
    const pdfParse: (b: Buffer | Uint8Array) => Promise<{ text?: string }> =
      (mod as any).default ?? (mod as any);
    if (typeof pdfParse !== "function") throw new Error("pdf-parse export not a function");

    const data = await pdfParse(buf);
    const text = (data?.text || "").trim();
    if (text && text.replace(/\s+/g, "").length >= 50) {
      return { text, warnings };
    }
    warnings.push("Low text from pdf-parse; using pdfjs-dist text fallback.");
  } catch (e: any) {
    warnings.push(`pdf-parse failed: ${e?.message ?? String(e)}`);
  }

  // 2) Fallback: pdfjs-dist text extraction
  try {
    const text = await extractWithPdfJs(buf);
    if (text && text.replace(/\s+/g, "").length >= 50) {
      return { text, warnings };
    }
    warnings.push("Low text from pdfjs-dist; using OCR fallback.");
  } catch (e: any) {
    warnings.push(`pdfjs-dist text failed: ${e?.message ?? String(e)}`);
  }

  // 3) OCR fallback: render pages to images with pdf.js + recognize with tesseract.js
  try {
    const { text, warnings: ocrWarn } = await ocrWithTesseract(buf);
    return { text, warnings: warnings.concat(ocrWarn) };
  } catch (e: any) {
    warnings.push(`OCR failed: ${e?.message ?? String(e)}`);
    throw new Error(warnings.join(" | "));
  }
}
