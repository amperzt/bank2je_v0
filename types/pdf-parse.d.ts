// types/pdf-parse.d.ts
declare module "pdf-parse";
declare module "pdf-parse/lib/pdf-parse.js";
// types/pdfjs-dist.d.ts
declare module "pdfjs-dist/*" {
  export const GlobalWorkerOptions: { workerSrc: any };
  export function getDocument(src: any): { promise: Promise<any> };
}
