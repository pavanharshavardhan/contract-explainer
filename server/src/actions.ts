// Actions for Contract Explainer.
//
// The core action is `explainDocument`: it takes an uploaded document file
// (PDF, DOCX, or TXT — the text is extracted server-side by
// `extractTextFromDocument`) and/or photos of its pages, runs one bounded
// `ctx.inference.complete` extraction against a strict Zod schema, stores
// the validated report, and returns it for rendering as a one-page brief.
// The other actions list, fetch, and delete saved reports.

import { defineAction, z, type ActionsModule } from "@hatch/space-sdk";
import { desc, eq } from "drizzle-orm";
import { extractTextFromDocument, type DocumentFileKind } from "./extract";
import * as schema from "./schema";

/** The structured one-pager. Shared by the inference call and the API. */
const reportSchema = z.object({
  docType: z
    .string()
    .describe(
      "The kind of document, e.g. 'Residential Lease', 'Job Offer Letter', 'Termination Letter', 'Sales Contract'.",
    ),
  title: z
    .string()
    .describe(
      "A short identifying title for the document, e.g. 'Lease — Unit 4B, 120 Oak Street' or 'Offer Letter — ML Engineer, Acme Corp'.",
    ),
  bottomLine: z
    .string()
    .describe(
      "ONE short plain-English sentence only (max ~22 words): what this document is and the single most important thing to know. No second sentence.",
    ),
  parties: z
    .array(z.object({ role: z.string(), name: z.string() }))
    .max(4)
    .describe("Only the main people or companies involved, with their role. Keep names short."),
  keyDates: z
    .array(
      z.object({
        label: z.string(),
        date: z.string(),
        note: z.string(),
      }),
    )
    .max(10)
    .describe(
      "Every key date only: start/end, deadlines, due dates, notice deadlines. Label max 4 words. Date as written. Note max 6 words or empty string if self-evident. Merge dates that share the same deadline into one item.",
    ),
  money: z
    .array(
      z.object({
        label: z.string(),
        amount: z.string(),
        note: z.string(),
      }),
    )
    .max(8)
    .describe(
      "Only the most important amounts (max 8): rent/salary, deposit, break/exit cost, main fees/penalties. Label max 4 words. Amount exactly as stated; if defined by formula (e.g. two months' rent), give computed value too. Note max 6 words or empty. Merge small related charges into one line instead of listing each separately.",
    ),
  headlineFigure: z
    .object({ label: z.string(), amount: z.string() })
    .nullable()
    .describe(
      "The single most important total the reader walks away with — total pay for a job offer, severance total for a termination, total cost to break a lease, total contract value. Null when no single total makes sense.",
    ),
  obligations: z
    .array(z.object({ who: z.string(), what: z.string() }))
    .max(7)
    .describe(
      "Only the most important obligations (max 7). 'what' max 12 words, plain English, no filler. Merge overlapping duties for the same party into one item.",
    ),
  watchOuts: z
    .array(z.string())
    .max(6)
    .describe(
      "Only the biggest traps (max 6): penalties, auto-renewal, forfeiture, unilateral changes, expiring deadlines. Each max 14 words. Merge overlapping warnings into one.",
    ),
  nextSteps: z
    .array(z.string())
    .max(4)
    .describe(
      "Only essential next actions (max 4), in order. Each max 10 words. Omit anything obvious or already covered above.",
    ),
});

type Report = z.infer<typeof reportSchema>;

const imageInput = z.object({
  dataBase64: z.string().min(1).max(16_000_000),
  mimeType: z.string(),
});

const fileInput = z.object({
  name: z.string().min(1).max(200),
  kind: z.enum(["pdf", "docx", "txt"]),
  dataBase64: z.string().min(1).max(28_000_000),
});

const documentSummary = z.object({
  id: z.number(),
  title: z.string(),
  docType: z.string(),
  sourceKind: z.enum(["text", "file", "photo"]),
  created_at: z.string(),
});

const SYSTEM_PROMPT = [
  "You turn dense legal and business documents — leases, job offer letters,",
  "termination letters, contracts, property documents — into a SHORT one-page",
  "brief for a non-lawyer reader. Aim for a report that fits 1-2 pages when",
  "copied out — concise beats complete-sounding.",
  "",
  "Rules:",
  "- Extract ONLY facts the document actually states. Never invent a date,",
  "  amount, name, or term that is not in the document.",
  "- Keep EVERY key date, key money figure, key obligation and key watch-out",
  "  — do not drop a key fact to save space. Save space by wording, not by",
  "  cutting facts.",
  "- Be terse: fewest words per item. Short phrases, no filler, no repeating",
  "  the label inside the note, no legal jargon. Cut words like 'is required",
  "  to', 'in accordance with', 'shall be responsible for' — say 'must'.",
  "- Merge overlapping items: combine related charges, duties or warnings",
  "  that say nearly the same thing into a single item.",
  "- Prioritise: money max 8 items and obligations max 7 — if there are",
  "  more, keep the largest / most consequential and merge or drop the minor",
  "  ones. Bottom line is ONE sentence. Notes are fragments, not sentences.",
  "- Drop boilerplate entirely. Keep only what changes a decision.",
  "- Amounts: quote them as written (currency and figure). If the document",
  "  defines an amount by formula (two months' rent, 3% annual increase),",
  "  compute the concrete value from figures in the document and include it.",
  "- Dates: keep them as written in the document; do not convert formats.",
  "- For a job offer, the headline figure is the total pay (base + stated",
  "  bonus/equity cash value) when the document supports it. For a",
  "  termination letter, it is the total severance/final payout. For a",
  "  lease, it is the total cost to break the lease early, or the total",
  "  due at signing when no break cost is stated.",
].join("\n");

export const Actions = {
  explainDocument: defineAction({
    description:
      "Explains a document (uploaded PDF/DOCX/TXT file or page photos) into a stored one-page report of its key dates, money, obligations, and watch-outs.",
    request: z.object({
      title: z.string().trim().max(120).optional(),
      file: fileInput.optional(),
      images: z.array(imageInput).max(8).optional(),
    }),
    response: z.object({
      id: z.number(),
      report: reportSchema,
    }),
    async handler(ctx, args) {
      const images = (args.images ?? []).filter(
        (img) => img.mimeType === "image/jpeg" || img.mimeType === "image/png",
      );
      if (!args.file && images.length === 0) {
        throw new Error(
          "Add the document first — upload its file (PDF, DOCX, or TXT) or attach photos of its pages.",
        );
      }

      let text = "";
      if (args.file) {
        try {
          text = (
            await extractTextFromDocument(
              args.file.dataBase64,
              args.file.kind as DocumentFileKind,
            )
          ).trim();
        } catch {
          throw new Error(
            "That file could not be read. Try a different copy of the document, or use photos of its pages instead.",
          );
        }
        if (!text && images.length === 0) {
          throw new Error(
            args.file.kind === "pdf"
              ? "No readable text was found in that PDF — it may be a scan. Use photos of its pages instead."
              : "No readable text was found in that file. Try a different copy, or use photos of its pages instead.",
          );
        }
      }

      const promptParts: string[] = [
        "Explain the following document as a SHORT one-page brief, following the field guidance exactly. Keep every key fact but write each item in as few words as possible and merge overlapping items.",
      ];
      if (args.title) {
        promptParts.push(`The reader calls this document: ${args.title}`);
      }
      if (text) {
        promptParts.push("", "Document text:", text.slice(0, 60_000));
      }
      if (images.length > 0) {
        promptParts.push(
          "",
          `The document is attached as ${images.length} page photo(s). Read every page before extracting.`,
        );
      }

      const report: Report = await ctx.inference.complete(promptParts.join("\n"), {
        schema: reportSchema,
        system: SYSTEM_PROMPT,
        timeout_secs: 180,
        ...(images.length > 0
          ? {
              images: images.map((img) => ({
                dataBase64: img.dataBase64,
                mimeType: img.mimeType as "image/jpeg" | "image/png",
              })),
            }
          : {}),
      });

      const db = ctx.db<typeof schema>();
      const inserted = await db
        .insert(schema.documents)
        .values({
          title: args.title?.trim() ? args.title.trim() : report.title,
          docType: report.docType,
          sourceKind: args.file ? "file" : "photo",
          reportJson: JSON.stringify(report),
        })
        .returning({ id: schema.documents.id });
      const row = inserted[0];
      if (!row) throw new Error("Could not save the report. Please try again.");
      ctx.invalidateQueries();
      return { id: row.id, report };
    },
  }),

  listDocuments: defineAction({
    description: "Lists saved one-page reports, newest first.",
    request: z.object({
      limit: z.number().int().positive().max(100).default(30),
    }),
    response: z.object({
      documents: z.array(documentSummary),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select({
          id: schema.documents.id,
          title: schema.documents.title,
          docType: schema.documents.docType,
          sourceKind: schema.documents.sourceKind,
          createdAt: schema.documents.createdAt,
        })
        .from(schema.documents)
        .orderBy(desc(schema.documents.id))
        .limit(args.limit);
      return {
        documents: rows.map((row) => ({
          id: row.id,
          title: row.title,
          docType: row.docType,
          sourceKind: row.sourceKind,
          created_at: row.createdAt.toISOString(),
        })),
      };
    },
  }),

  getDocument: defineAction({
    description: "Returns one saved report in full, by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({
      document: documentSummary.extend({ report: reportSchema }),
    }),
    async handler(ctx, args) {
      const db = ctx.db<typeof schema>();
      const rows = await db
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, args.id))
        .limit(1);
      const row = rows[0];
      if (!row) throw new Error("That report no longer exists.");
      const parsed = reportSchema.safeParse(JSON.parse(row.reportJson));
      if (!parsed.success) throw new Error("That saved report is unreadable.");
      return {
        document: {
          id: row.id,
          title: row.title,
          docType: row.docType,
          sourceKind: row.sourceKind,
          created_at: row.createdAt.toISOString(),
          report: parsed.data,
        },
      };
    },
  }),

  deleteDocument: defineAction({
    description: "Deletes one saved report by id.",
    request: z.object({ id: z.number().int().positive() }),
    response: z.object({ ok: z.literal(true) }),
    async handler(ctx, args): Promise<{ ok: true }> {
      const db = ctx.db<typeof schema>();
      await db
        .delete(schema.documents)
        .where(eq(schema.documents.id, args.id));
      ctx.invalidateQueries();
      return { ok: true };
    },
  }),
} satisfies ActionsModule;
