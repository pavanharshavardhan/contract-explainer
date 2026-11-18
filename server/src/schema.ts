// Drizzle schema for this space.
//
// One table: `documents` — each row is one explained document. The full
// structured one-pager produced by the model is stored as JSON in
// `report_json`; the list view only needs the denormalized title and
// document type, so those live in their own columns.

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const documents = sqliteTable("documents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  docType: text("doc_type").notNull(),
  /** How the document arrived: "file" (uploaded PDF/DOCX/TXT) or "photo".
   * ("text" remains for reports saved before file upload existed.) */
  sourceKind: text("source_kind", { enum: ["text", "file", "photo"] }).notNull(),
  /** The structured one-pager report, JSON-encoded. */
  reportJson: text("report_json").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});
