# Contract Explainer

Upload a contract, lease, offer letter, termination letter, or property document —
as a PDF, DOCX, or TXT file, or as photos of its pages — and get a short
one-page brief in plain English: the bottom line, the headline figure, a money
ledger, key dates, each side's obligations, watch-outs (penalties and traps),
and next steps. Everything you explain is saved in-app under "Your explained
documents" so you can reopen it later, or copy it out as plain text.

No legal advice: the brief only restates what the document itself says, and
never invents a date, amount, name, or term that isn't in it.

## What it handles

- **Leases** — rent, deposit, what it costs to break the lease early, notice
  deadlines, renewal terms
- **Offer letters** — total first-year pay (base + stated bonus/equity cash
  value), start date, key terms
- **Termination letters** — severance / total final payout, key dates,
  obligations after leaving
- **Property and other documents** — the same one-page brief format

Scanned PDFs with no text layer can't be read as files — use photos of the
pages instead.

## How it works

- **Client** (`client/`, React + TypeScript): upload a document file
  (PDF/DOCX/TXT, up to 20 MB) or up to 8 page photos, give it a title, and
  view the generated brief. Reports are listed newest-first and can be
  deleted.
- **Server** (`server/src/actions.ts`): extracts the document text
  server-side — PDF.js for PDFs, mammoth for DOCX, UTF-8 decode for TXT
  (`server/src/extract.ts`) — then asks the model for a structured brief
  with a conciseness-first prompt: bottom line in one sentence, money capped
  at the 8 most important items, obligations at 7, watch-outs at 6, next steps
  at 4, short phrases, overlapping items merged, boilerplate dropped. The
  brief is validated against a Zod schema and stored as JSON in the
  `documents` table (`drizzle/` migrations, `server/src/schema.ts`).

## Running it

This project is a [Muse](https://muse.ai) TypeScript space
(`space.json`, runtime `typescript`). The server actions use the space
runtime's managed inference (`ctx.inference.complete`) and database
(`ctx.db`), so it runs as-is inside Muse; the code here is the full source
for reference and porting.

```bash
bun install
bun run typecheck   # tsc --noEmit for client and server
bun run build       # build server bundle, then client bundle
```

## Project layout

```
client/src/    React app (App.tsx, api.ts, theme.css, main.tsx)
server/src/    actions.ts (explainDocument + report actions),
               extract.ts (PDF/DOCX/TXT text extraction),
               schema.ts (documents table)
drizzle/       SQL migrations for the documents table
```

## Privacy

Reports are stored only in the app's own database. This repo contains source
code only — no documents, reports, or personal data.
