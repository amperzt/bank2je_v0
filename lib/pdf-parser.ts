// lib/pdf-parser.ts
import { existsSync } from "fs";
import { dirname, join, resolve as pathResolve } from "path";
import { pathToFileURL } from "url";
import { createRequire } from "module";

export type PdfParseResult = {
  text?: string;
  warnings?: string[];
  strategy?: "pdf-parse" | "pdfjs-dist" | "ocr";
};

/* -------------------- locate pdfjs-dist on disk -------------------- */

function findPdfjsBaseDir(startDir: string): string | null {
  let dir = pathResolve(startDir);
  const root = pathResolve("/");
  while (true) {
    const candidate = join(dir, "node_modules", "pdfjs-dist");
    if (existsSync(join(candidate, "package.json"))) return candidate;
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function resolvePdfjsBaseDir(): string {
  try {
    const r1 = createRequire(process.cwd() + "/package.json");
    const pkg1 = r1.resolve("pdfjs-dist/package.json");
    if (pkg1 && !pkg1.startsWith("(rsc)")) return dirname(pkg1);
  } catch {}
  try {
    const r2 = createRequire(import.meta.url);
    const pkg2 = r2.resolve("pdfjs-dist/package.json");
    if (pkg2 && !pkg2.startsWith("(rsc)")) return dirname(pkg2);
  } catch {}
  const walked = findPdfjsBaseDir(process.cwd());
  if (walked) return walked;
  // @ts-ignore __dirname exists after build
  const here = typeof __dirname === "string" ? __dirname : process.cwd();
  const walked2 = findPdfjsBaseDir(here);
  if (walked2) return walked2;
  throw new Error("pdfjs-dist base directory not found.");
}

/** ESM loader (mjs), with minified fallbacks + webpackIgnore so bundler doesn’t rewrite it */
async function loadPdfJs(): Promise<any> {
  const base = resolvePdfjsBaseDir();
  const candidates = [
    "build/pdf.mjs",
    "build/pdf.min.mjs",
    "legacy/build/pdf.mjs",
    "legacy/build/pdf.min.mjs",
  ].map((rel) => join(base, rel));

  let found = "";
  for (const p of candidates) {
    if (existsSync(p)) { found = p; break; }
  }
  if (!found) {
    throw new Error(`pdfjs-dist module file not found. base=${base} tried=[${candidates.join(", ")}]`);
  }

  // @ts-ignore tell webpack to ignore this dynamic import
  const mod: any = await import(/* webpackIgnore: true */ pathToFileURL(found).href);
  const api = mod?.getDocument ? mod : (mod?.default || mod);
  if (!api?.getDocument) throw new Error("pdfjs-dist loaded but getDocument missing");
  return api;
}

/** Build getDocument options (includes standard fonts path) */
function makePdfJsDocOpts(buf: Buffer) {
  const base = resolvePdfjsBaseDir();
  const fontsDir = join(base, "standard_fonts"); // directory containing *.ttf
  const fontsUrl = pathToFileURL(fontsDir + "/").href; // trailing slash is important
  return {
    data: new Uint8Array(buf),
    disableWorker: true,
    isEvalSupported: false,
    useWorkerFetch: false,
    standardFontDataUrl: fontsUrl,
  };
}

/* -------------------- extractors -------------------- */

async function extractWithPdfParse(buf: Buffer): Promise<string> {
  const mod: any = await import("pdf-parse/lib/pdf-parse.js"); // skip index self-test
  const pdfParse: any = mod.default ?? mod;
  if (typeof pdfParse !== "function") throw new Error("pdf-parse export not a function");
  const data = await pdfParse(buf);
  return String(data?.text ?? "").trim();
}

async function extractWithPdfJs(buf: Buffer): Promise<string> {
  const PDF = await loadPdfJs();
  const task = PDF.getDocument(makePdfJsDocOpts(buf));
  const doc = await task.promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent().catch(() => ({ items: [] as any[] }));
    out += (content.items as any[]).map((it: any) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  await doc.destroy();
  return out.trim();
}

/** OCR: render pages (pdf.js → node-canvas) → tesseract */
async function ocrWithTesseract(buf: Buffer): Promise<string> {
  const PDF = await loadPdfJs();

  // Robust import for node-canvas across CJS/ESM builds
  const CanvasMod: any = await import("canvas");
  const createCanvas =
    CanvasMod?.createCanvas ?? CanvasMod?.default?.createCanvas;
  if (!createCanvas) {
    throw new Error(
      "node-canvas not available. Ensure `npm i canvas` succeeded and system libs are installed (macOS: brew install pkg-config cairo pango libpng jpeg giflib librsvg)."
    );
  }

  const Tesseract: any = await import("tesseract.js");
  const worker: any = await Tesseract.createWorker?.();
  if (!worker) throw new Error("tesseract.js createWorker() unavailable.");

  if (typeof worker.loadLanguage === "function" && typeof worker.initialize === "function") {
    await worker.loadLanguage("eng"); await worker.initialize("eng");   // v5 API
  } else if (typeof worker.reinitialize === "function") {
    await worker.reinitialize("eng");                                   // v6 API
  }

  const task = PDF.getDocument(makePdfJsDocOpts(buf));
  const doc = await task.promise;

  let text = "";
  try {
    const SCALE = 3.0; // higher DPI improves OCR
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: SCALE });
      const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
      const ctx = canvas.getContext("2d") as any;

      const renderTask = page.render({ canvasContext: ctx, viewport: vp, intent: "print" });
      await renderTask.promise;

      // Optional: simple binarization to help OCR on faint scans
      // const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // // ... preprocess here if needed ...
      // ctx.putImageData(imgData, 0, 0);

      const png = canvas.toBuffer("image/png");
      const res = await worker.recognize(png);
      text += (res?.data?.text || "") + "\n";
    }
  } finally {
    await doc.destroy();
    await worker.terminate?.();
  }
  return text.trim();
}

/* -------------------- main entry -------------------- */

export async function parsePdfSmart(buf: Buffer): Promise<PdfParseResult> {
  const warnings: string[] = [];

  // 1) pdf-parse
  try {
    const t = await extractWithPdfParse(buf);
    if (t && t.replace(/\s+/g, "").length >= 50) return { text: t, warnings, strategy: "pdf-parse" };
    warnings.push("Low text from pdf-parse; trying pdfjs-dist.");
  } catch (e: any) {
    warnings.push(`pdf-parse failed: ${e?.message ?? String(e)}`);
  }

  // 2) pdf.js text
  try {
    const t = await extractWithPdfJs(buf);
    if (t && t.replace(/\s+/g, "").length >= 50) return { text: t, warnings, strategy: "pdfjs-dist" };
    warnings.push("Low text from pdfjs-dist; trying OCR.");
  } catch (e: any) {
    warnings.push(`pdfjs-dist text failed: ${e?.message ?? String(e)}`);
  }

  // 3) OCR
  try {
    const t = await ocrWithTesseract(buf);
    if (t) warnings.push("OCR used (tesseract.js).");
    return { text: t, warnings, strategy: "ocr" };
  } catch (e: any) {
    warnings.push(`OCR failed: ${e?.message ?? String(e)}`);
    throw new Error(warnings.join(" | "));
  }
}
