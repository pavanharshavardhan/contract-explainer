// Server-side text extraction for uploaded document files.
//
// The client sends the uploaded file's bytes (base64) plus its kind; this
// module pulls the plain text out so `explainDocument` can run the same
// one-page extraction it used to run on pasted text:
// - "txt"  — decoded as UTF-8 directly.
// - "docx" — mammoth's raw-text extraction (paragraphs and tables).
// - "pdf"  — PDF.js (legacy Node build), page by page, using each page's
//   text content. Scanned/image-only PDFs yield no text; the caller turns
//   that into a "use page photos instead" error.

import mammoth from "mammoth";
import {
  GlobalWorkerOptions,
  getDocument,
} from "pdfjs-dist/legacy/build/pdf.mjs";

// The server bundle inlines PDF.js's main module, so its fallback worker
// cannot find pdf.worker.mjs beside the bundle. Point it at the installed
// package file (the same relative path resolves from both server/src and
// server/dist).
GlobalWorkerOptions.workerSrc = new URL(
  "../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url,
).href;

export type DocumentFileKind = "pdf" | "docx" | "txt";

async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocument({ data: bytes }).promise;
  try {
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      let line = "";
      const lines: string[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        } else {
          line += " ";
        }
      }
      if (line.trim()) lines.push(line);
      pages.push(lines.join("\n"));
    }
    return pages.join("\n\n");
  } finally {
    await pdf.destroy();
  }
}

export async function extractTextFromDocument(
  dataBase64: string,
  kind: DocumentFileKind,
): Promise<string> {
  const bytes = Buffer.from(dataBase64, "base64");
  if (kind === "txt") {
    return bytes.toString("utf-8");
  }
  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return result.value;
  }
  return extractPdfText(new Uint8Array(bytes));
}
