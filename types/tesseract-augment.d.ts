declare module "tesseract.js" {
  export interface Worker {
    loadLanguage?: (lang: string) => Promise<void>;
    initialize?: (lang: string) => Promise<void>;
    reinitialize?: (lang: string) => Promise<void>;
    recognize: (image: any) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<void>;
  }
  export function createWorker(...args: any[]): Promise<Worker>;
}
