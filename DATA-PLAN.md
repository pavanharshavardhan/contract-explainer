# Data Plan

## Context provenance
- `I want you to create an application that generates a one page report which will list out all the key things` (verbatim user request; the one-pager is the core deliverable)
- `if it's a lease one what's the rent how much to pay, how much to break out of it` (verbatim user request; money section must surface rent, deposit, and early-exit cost for leases)
- `severance pay ... like the total pay off the that particular role` (verbatim user request; money section must surface severance and total compensation for offer/termination letters)
- `Important dates` and `payment terms` called out explicitly in the request (verbatim user request; dedicated Key Dates and Money sections in every report)
- `separates all the bogus or maybe most of the rules just the most important information` (verbatim user request; extraction prompt instructs the model to drop boilerplate and keep only decision-relevant facts)
- `Make changes to code so that not text is kept but doc is to be uploaded there` (verbatim user edit request, Nov 18, 2026; the paste-text input was removed — the user uploads the document file itself, PDF/DOCX/TXT, or photos of pages)
- `Make prompt so that doc generate size should be slightly smaller` (verbatim user edit request, Nov 18, 2026; generation prompt and schema tightened for conciseness — bottom line one sentence, money capped at 8 most-important items, obligations at 7, watch-outs at 6, next steps at 4, per-item word limits and merge-overlapping instructions — while keeping every key date/figure/obligation/watch-out; report rendering also slightly tightened so the finished brief aims for 1–2 pages instead of 3)

## Tested sources
### ctx.inference.complete (managed model inference, server-side only)
**Used by**: `explainDocument` action — extracts the structured one-pager from pasted text, an uploaded text file's contents, or photos of document pages (JPEG/PNG attachments)
**Test command**: `bun /opt/muse/assets/spaces/ts-runtime/dist/probe-ctx.js < /tmp/probe-inference2.ts` (probe pre-provides `ctx` and `z`; a sample residential lease was extracted with a Zod schema)
**Sample output**: `{ docType: "Residential Lease Agreement", summary: "...", keyDates: [{label: "Lease start date", date: "March 1, 2026"}, {label: "Lease end date", date: "February 28, 2027"}], money: [{label: "Monthly rent", amount: "$1,850"}, {label: "Security deposit", amount: "$1,850"}, {label: "Early termination fee", amount: "Two months' rent ($3,700)"}] }` — extraction was accurate, including computing the two-months'-rent fee
**Processing**: The action sends the document text (truncated to a safe length) plus an instruction to extract only what is actually stated — never invent figures — into a Zod-validated schema: document type, plain-English bottom line, parties, key dates, money items (with a computed total where the document supports one), obligations for each side, watch-outs (penalties, auto-renewal, notice traps), and next steps. The validated result is stored as JSON in the `documents` table and rendered as the one-pager.

### Server-side document text extraction (pdfjs-dist + mammoth)
**Used by**: `explainDocument` action via `server/src/extract.ts` — the client uploads the document file itself (PDF, DOCX, or TXT, up to 20 MB) as base64; the server extracts its text before inference. Photos of pages still go straight to inference as images.
**Test command**: A hand-built one-page PDF lease, a python-docx offer letter, and a TXT termination note were extracted with the bundled server code (`bun build server/src/extract.ts` run from `server/dist`), and the PDF and TXT were also run end-to-end through the published `explainDocument` action in the sandbox.
**Sample output**: PDF lease → `RESIDENTIAL LEASE - Monthly rent $1,850, deposit $1,850. / Term: March 1, 2026 to February 28, 2027. Early termination fee: two months rent.`; the resulting report computed the $3,700 break cost. DOCX → paragraphs extracted verbatim by mammoth. TXT → decoded as UTF-8.
**Processing**: PDF.js (legacy Node build) reads each page's text content — `GlobalWorkerOptions.workerSrc` points at the installed `pdf.worker.mjs` because the bundled server inlines the main module. Mammoth extracts raw DOCX text. A PDF with no readable text layer (a scan) returns empty text and the action tells the user to use page photos instead.
**Packages**: `pdfjs-dist@5.4.624` and `mammoth@1.13.0`, added to the artifact's own `package.json` dependencies with `bun add`.

## Long-term data behavior
- **Refresh policy**: None — reports are generated on demand from documents the user supplies; nothing external changes.
- **Growth**: One row per explained document; the user can delete reports. History list is newest-first and capped in the list query.
- **Ordering**: Reports listed newest first by creation time.
- **Time semantics**: `created_at` is a creation instant rendered viewer-local. Dates inside a report are the document's own stated dates, kept as written in the document (no timezone conversion).

## Rejected approaches
- **Tried**: Client-side PDF text extraction via pdfjs-dist
  **Why rejected**: `pdfjs-dist` is not installed in the artifact's node_modules (only the SDK's bundled PdfViewer assets exist), and the PdfViewer component renders pages but exposes no text layer. Instead the app accepts pasted text, plain-text file uploads read in the browser, and photos/scans of pages (JPEG/PNG) which `ctx.inference.complete` accepts as image attachments — covering how users actually hold these documents.
  **Superseded Nov 18, 2026**: The user asked for file upload instead of pasting text. `pdfjs-dist` and `mammoth` are now installed as artifact dependencies and extraction runs server-side (see "Server-side document text extraction" above); the paste-text input was removed.
- **Tried**: Seeding the history with a sample explained lease
  **Why rejected**: The user did not ask for demo content; the artifact is a user-entry tool and starts empty with a clear first-run state.
