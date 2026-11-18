import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";
import { SafeAreaTopScrim, fileToBase64 } from "@hatch/space-sdk/client";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, type ApiResponse } from "./api";

const FIELDS = actionFields<typeof Actions>();

type Report = ApiResponse<typeof api, "explainDocument">["report"];
type DocSummary = ApiResponse<typeof api, "listDocuments">["documents"][number];

type PageImage = { dataBase64: string; mimeType: string; preview: string };
type DocFileKind = "pdf" | "docx" | "txt";
type DocFile = {
  name: string;
  kind: DocFileKind;
  dataBase64: string;
  sizeBytes: number;
};
type InputMode = "file" | "photo";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Which supported document kind an uploaded file is, or null if it isn't one. */
function docFileKind(file: File): DocFileKind | null {
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") return "pdf";
  if (
    name.endsWith(".docx") ||
    file.type ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    file.type === "text/plain" ||
    file.type === "text/markdown"
  ) {
    return "txt";
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Downscale a photo to a JPEG the inference call can take. */
async function fileToPageImage(file: File): Promise<PageImage> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("That photo could not be read."));
      el.src = objectUrl;
    });
    const maxDim = 1600;
    const scale = Math.min(
      1,
      maxDim / Math.max(img.naturalWidth, img.naturalHeight),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) throw new Error("That photo could not be processed.");
    ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    return {
      dataBase64: dataUrl.split(",")[1] ?? "",
      mimeType: "image/jpeg",
      preview: dataUrl,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function reportToPlainText(report: Report): string {
  const lines: string[] = [report.title, report.docType, "", report.bottomLine];
  if (report.headlineFigure) {
    lines.push("", `${report.headlineFigure.label}: ${report.headlineFigure.amount}`);
  }
  if (report.money.length > 0) {
    lines.push("", "MONEY");
    for (const m of report.money) {
      lines.push(`- ${m.label}: ${m.amount}${m.note ? ` (${m.note})` : ""}`);
    }
  }
  if (report.keyDates.length > 0) {
    lines.push("", "KEY DATES");
    for (const d of report.keyDates) {
      lines.push(`- ${d.label}: ${d.date}${d.note ? ` — ${d.note}` : ""}`);
    }
  }
  if (report.obligations.length > 0) {
    lines.push("", "OBLIGATIONS");
    for (const o of report.obligations) lines.push(`- ${o.who}: ${o.what}`);
  }
  if (report.watchOuts.length > 0) {
    lines.push("", "WATCH OUT FOR");
    for (const w of report.watchOuts) lines.push(`- ${w}`);
  }
  if (report.nextSteps.length > 0) {
    lines.push("", "NEXT STEPS");
    report.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  return lines.join("\n");
}

function SectionHead({ children }: { children: string }) {
  return (
    <h3 className="font-serif text-[13px] font-semibold tracking-[0.18em] text-[var(--dim)] uppercase">
      {children}
    </h3>
  );
}

function ReportSheet({
  report,
  explainedOn,
}: {
  report: Report;
  explainedOn?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(reportToPlainText(report));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="border border-[var(--border)] bg-[var(--surface)] px-4 py-4 shadow-[0_1px_2px_rgba(25,24,23,0.06),0_12px_32px_-16px_rgba(25,24,23,0.25)] sm:px-6 sm:py-5">
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-[var(--text)] pb-3">
        <p className="text-[12px] font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
          {report.docType}
        </p>
        {explainedOn ? (
          <p className="shrink-0 text-[12px] text-[var(--dim)]">
            Explained {explainedOn}
          </p>
        ) : null}
      </div>

      <h2 className="mt-3 font-serif text-[22px] leading-tight font-semibold text-[var(--text)] sm:text-[25px]">
        {report.title}
      </h2>
      <p className="mt-2 font-serif text-[16px] leading-snug text-[var(--text)] italic">
        {report.bottomLine}
      </p>

      {report.headlineFigure ? (
        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 bg-[var(--accent-soft)] px-3 py-2">
          <span className="text-[12px] font-semibold tracking-[0.08em] text-[var(--accent)] uppercase">
            {report.headlineFigure.label}
          </span>
          <span className="font-serif text-[23px] leading-none font-bold text-[var(--accent)] tabular-nums">
            {report.headlineFigure.amount}
          </span>
        </div>
      ) : null}

      {report.parties.length > 0 ? (
        <dl className="mt-5 grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {report.parties.map((p, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-2">
              <dt className="text-[13px] text-[var(--dim)]">{p.role}</dt>
              <dd className="min-w-0 font-medium break-words text-[var(--text)]">{p.name}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {report.money.length > 0 ? (
        <section className="mt-5">
          <SectionHead>The money</SectionHead>
          <ul className="mt-2 divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {report.money.map((m, i) => (
              <li key={i} className="flex items-baseline justify-between gap-4 py-1.5">
                <div>
                  <p className="text-[15px] text-[var(--text)]">{m.label}</p>
                  {m.note ? (
                    <p className="text-[13px] text-[var(--dim)]">{m.note}</p>
                  ) : null}
                </div>
                <p className="shrink-0 font-serif text-[18px] font-semibold text-[var(--text)] tabular-nums">
                  {m.amount}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.keyDates.length > 0 ? (
        <section className="mt-5">
          <SectionHead>Key dates</SectionHead>
          <ul className="mt-2">
            {report.keyDates.map((d, i) => (
              <li
                key={i}
                className="relative border-l border-[var(--border)] py-1.5 pl-5 last:pb-0"
              >
                <span className="absolute top-[13px] -left-[4.5px] h-[8px] w-[8px] rounded-full bg-[var(--accent)]" />
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <p className="text-[15px] font-medium text-[var(--text)]">{d.label}</p>
                  <p className="font-serif text-[16px] font-semibold text-[var(--text)]">
                    {d.date}
                  </p>
                </div>
                {d.note ? (
                  <p className="text-[13px] text-[var(--dim)]">{d.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.obligations.length > 0 ? (
        <section className="mt-5">
          <SectionHead>Who has to do what</SectionHead>
          <ul className="mt-2 space-y-1.5">
            {report.obligations.map((o, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="shrink-0 font-semibold text-[var(--text)]">
                  {o.who}
                </span>
                <span className="text-[var(--text)]">{o.what}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.watchOuts.length > 0 ? (
        <section className="mt-5 border-l-[3px] border-[var(--accent)] bg-[var(--accent-soft)] px-4 py-3">
          <h3 className="font-serif text-[13px] font-semibold tracking-[0.18em] text-[var(--accent)] uppercase">
            Watch out for
          </h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-[var(--text)]">
            {report.watchOuts.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {report.nextSteps.length > 0 ? (
        <section className="mt-5">
          <SectionHead>Next steps</SectionHead>
          <ol className="mt-2 space-y-1.5">
            {report.nextSteps.map((s, i) => (
              <li key={i} className="flex gap-3 text-[15px] leading-relaxed">
                <span className="shrink-0 font-serif font-bold text-[var(--accent)]">
                  {i + 1}.
                </span>
                <span className="text-[var(--text)]">{s}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3">
        <p className="max-w-[46ch] text-[12px] leading-relaxed text-[var(--dim)]">
          A plain-English summary of the document you provided — check anything
          that matters against the original. Not legal advice.
        </p>
        <button
          type="button"
          onClick={copySummary}
          className="shrink-0 border border-[var(--border)] px-3 py-1.5 text-[13px] font-medium text-[var(--text)]"
        >
          {copied ? "Copied" : "Copy summary"}
        </button>
      </div>
    </article>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [freshReport, setFreshReport] = useState<Report | null>(null);

  const [mode, setMode] = useState<InputMode>("file");
  const [title, setTitle] = useState("");
  const [docFile, setDocFile] = useState<DocFile | null>(null);
  const [images, setImages] = useState<PageImage[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const docInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const history = useQuery({
    queryKey: ["documents"],
    queryFn: () => api.listDocuments({ limit: 30 }),
  });

  const selected = useQuery({
    queryKey: ["document", selectedId],
    queryFn: () => api.getDocument({ id: selectedId ?? 0 }),
    enabled: selectedId != null && freshReport == null,
  });

  const explain = useMutation({
    mutationFn: async () =>
      await api.explainDocument({
        title: title.trim() ? title.trim() : undefined,
        file:
          mode === "file" && docFile
            ? {
                name: docFile.name,
                kind: docFile.kind,
                dataBase64: docFile.dataBase64,
              }
            : undefined,
        images:
          mode === "photo" && images.length > 0
            ? images.map((img) => ({
                dataBase64: img.dataBase64,
                mimeType: img.mimeType,
              }))
            : undefined,
      }),
    onSuccess: (data) => {
      setFreshReport(data.report);
      setSelectedId(data.id);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      window.scrollTo({ top: 0 });
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Something went wrong.",
      );
    },
  });

  const remove = useMutation({
    mutationFn: async (id: number) => await api.deleteDocument({ id }),
    onSuccess: (_data, id) => {
      if (selectedId === id) {
        setSelectedId(null);
        setFreshReport(null);
      }
      setConfirmDeleteId(null);
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => {
      setFormError(
        error instanceof Error ? error.message : "Could not delete that report.",
      );
    },
  });

  const onPickDocument = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const kind = docFileKind(file);
    if (!kind) {
      setFormError(
        "That file type isn't supported — upload a PDF, DOCX, or TXT file.",
      );
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setFormError("That file is too large — the limit is 20 MB.");
      return;
    }
    try {
      const { dataBase64 } = await fileToBase64(file);
      setDocFile({ name: file.name, kind, dataBase64, sizeBytes: file.size });
      setFormError(null);
    } catch {
      setFormError("That file could not be read.");
    }
  };

  const onPickPhotos = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    try {
      const added: PageImage[] = [];
      for (const file of files.slice(0, 8 - images.length)) {
        added.push(await fileToPageImage(file));
      }
      setImages((prev) => [...prev, ...added]);
      setFormError(null);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "A photo could not be read.",
      );
    }
  };

  const startExplain = () => {
    if (mode === "photo") {
      if (images.length === 0) {
        setFormError("Add at least one photo of a page first.");
        return;
      }
    } else if (!docFile) {
      setFormError("Choose the document file first — PDF, DOCX, or TXT.");
      return;
    }
    setFormError(null);
    explain.mutate();
  };

  const openReport = (doc: DocSummary) => {
    setFreshReport(null);
    setSelectedId(doc.id);
    window.scrollTo({ top: 0 });
  };

  const startNew = () => {
    setSelectedId(null);
    setFreshReport(null);
    window.scrollTo({ top: 0 });
  };

  const showingReport = selectedId != null;
  const activeReport: Report | null =
    freshReport ?? selected.data?.document.report ?? null;
  const activeMeta: DocSummary | null =
    selected.data?.document ??
    (freshReport && selectedId != null
      ? (history.data?.documents.find((d) => d.id === selectedId) ?? null)
      : null);

  const modeTab = (value: InputMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => setMode(value)}
      className={`flex-1 px-3 py-2 text-[14px] font-medium ${
        mode === value
          ? "bg-[var(--text)] text-[var(--surface)]"
          : "text-[var(--dim)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <SafeAreaTopScrim backgroundColor="var(--bg)" />

      <main className="mx-auto w-full max-w-2xl px-4 pt-6 pb-10">
        {showingReport ? (
          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={startNew}
                className="text-[14px] font-medium text-[var(--accent)]"
              >
                ← Explain another document
              </button>
              {activeMeta ? (
                confirmDeleteId === activeMeta.id ? (
                  <span className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => remove.mutate(activeMeta.id)}
                      className="px-2 py-1 text-[13px] font-semibold text-[var(--accent)]"
                    >
                      Delete it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      className="px-2 py-1 text-[13px] text-[var(--dim)]"
                    >
                      Keep
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmDeleteId(activeMeta.id)}
                    className="px-2 py-1 text-[13px] text-[var(--dim)]"
                  >
                    Delete report
                  </button>
                )
              ) : null}
            </div>

            {activeReport ? (
              <ReportSheet
                report={activeReport}
                explainedOn={
                  activeMeta ? formatWhen(activeMeta.created_at) : undefined
                }
              />
            ) : selected.isPending ? (
              <p className="py-16 text-center text-[15px] text-[var(--dim)]">
                Opening the report…
              </p>
            ) : (
              <p className="py-16 text-center text-[15px] text-[var(--dim)]">
                That report could not be opened.
              </p>
            )}
          </div>
        ) : (
          <div>
            <h1 className="font-serif text-[34px] leading-tight font-semibold text-[var(--text)]">
              A big document, on one page.
            </h1>
            <p className="mt-2 max-w-[52ch] text-[15px] leading-relaxed text-[var(--dim)]">
              Lease, offer letter, termination letter, contract — upload the
              document itself. You get back the dates, the money, what you owe,
              what they owe, and the clauses that can bite.
            </p>

            <div className="mt-6 border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
              <div
                role="tablist"
                aria-label="How to add the document"
                className="flex border border-[var(--border)]"
              >
                {modeTab("file", "Upload file")}
                {modeTab("photo", "Page photos")}
              </div>

              <div className="mt-4">
                <label
                  htmlFor="doc-title"
                  className="text-[13px] font-medium text-[var(--dim)]"
                >
                  Name it (optional)
                </label>
                <input
                  id="doc-title"
                  {...FIELDS.explainDocument.title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Lease for the new apartment"
                  className="mt-1 w-full border border-[var(--border)] bg-transparent px-3 py-2 text-[15px] text-[var(--text)] outline-none placeholder:text-[var(--dim)] focus:border-[var(--accent)]"
                />
              </div>

              {mode !== "photo" ? (
                <div className="mt-4">
                  <p className="text-[13px] font-medium text-[var(--dim)]">
                    The document file — PDF, DOCX, or TXT (up to 20 MB)
                  </p>
                  {docFile ? (
                    <div className="mt-2 flex items-center justify-between gap-3 border border-[var(--border)] px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-medium text-[var(--text)]">
                          {docFile.name}
                        </p>
                        <p className="text-[13px] text-[var(--dim)]">
                          {docFile.kind.toUpperCase()} ·{" "}
                          {formatBytes(docFile.sizeBytes)}
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${docFile.name}`}
                        onClick={() => setDocFile(null)}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--text)] text-[15px] text-[var(--surface)]"
                      >
                        ×
                      </button>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => docInputRef.current?.click()}
                    className="mt-2 border border-[var(--border)] px-3 py-2 text-[14px] font-medium text-[var(--text)]"
                  >
                    {docFile ? "Choose a different file" : "Choose the document file"}
                  </button>
                  <input
                    ref={docInputRef}
                    type="file"
                    accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                    aria-label="Choose the document file"
                    className="hidden"
                    onChange={onPickDocument}
                  />
                  <p className="mt-2 text-[12px] text-[var(--dim)]">
                    The app reads the text out of the file itself — nothing to
                    copy and paste. If a PDF is a scan with no readable text,
                    use page photos for it instead.
                  </p>
                </div>
              ) : (
                <div className="mt-4">
                  <p className="text-[13px] font-medium text-[var(--dim)]">
                    Photos of the pages, in order (up to 8)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {images.map((img, i) => (
                      <span key={i} className="relative inline-block">
                        <img
                          src={img.preview}
                          alt={`Page ${i + 1} of the document`}
                          className="h-24 w-[72px] border border-[var(--border)] object-cover"
                        />
                        <button
                          type="button"
                          aria-label={`Remove page ${i + 1}`}
                          onClick={() =>
                            setImages((prev) => prev.filter((_, j) => j !== i))
                          }
                          className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-[var(--text)] text-[13px] text-[var(--surface)]"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {images.length < 8 ? (
                      <button
                        type="button"
                        onClick={() => photoInputRef.current?.click()}
                        className="flex h-24 w-[72px] items-center justify-center border border-dashed border-[var(--border)] text-[24px] text-[var(--dim)]"
                        aria-label="Add page photos"
                      >
                        +
                      </button>
                    ) : null}
                  </div>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    aria-label="Add page photos"
                    className="hidden"
                    onChange={onPickPhotos}
                  />
                  <p className="mt-2 text-[12px] text-[var(--dim)]">
                    For paper documents and scans saved as images. A PDF with
                    readable text is easier — upload the file itself instead.
                  </p>
                </div>
              )}

              {formError ? (
                <p role="alert" className="mt-3 text-[14px] text-[var(--accent)]">
                  {formError}
                </p>
              ) : null}

              <button
                type="button"
                onClick={startExplain}
                disabled={explain.isPending}
                className="mt-4 w-full bg-[var(--accent)] px-4 py-3 font-serif text-[18px] font-semibold text-white disabled:opacity-60"
              >
                {explain.isPending
                  ? "Reading the fine print…"
                  : "Explain it on one page"}
              </button>
              {explain.isPending ? (
                <p className="mt-2 text-center text-[13px] text-[var(--dim)]">
                  Pulling out the dates, the money, and the traps — this can
                  take a little while for a long document.
                </p>
              ) : null}
            </div>

            <section className="mt-8">
              <h2 className="font-serif text-[13px] font-semibold tracking-[0.18em] text-[var(--dim)] uppercase">
                Your explained documents
              </h2>
              {history.isPending ? (
                <p className="mt-3 text-[14px] text-[var(--dim)]">Loading…</p>
              ) : history.data && history.data.documents.length > 0 ? (
                <ul className="mt-3 divide-y divide-[var(--border)] border-y border-[var(--border)] bg-[var(--surface)]">
                  {history.data.documents.map((doc) => (
                    <li key={doc.id} className="flex items-center gap-2 px-4">
                      <button
                        type="button"
                        onClick={() => openReport(doc)}
                        className="min-w-0 flex-1 py-3 text-left"
                      >
                        <span className="block truncate text-[15px] font-medium text-[var(--text)]">
                          {doc.title}
                        </span>
                        <span className="block text-[13px] text-[var(--dim)]">
                          {doc.docType} · {formatWhen(doc.created_at)}
                        </span>
                      </button>
                      {confirmDeleteId === doc.id ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() => remove.mutate(doc.id)}
                            className="px-2 py-1 text-[13px] font-semibold text-[var(--accent)]"
                          >
                            Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 text-[13px] text-[var(--dim)]"
                          >
                            Keep
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label={`Delete ${doc.title}`}
                          onClick={() => setConfirmDeleteId(doc.id)}
                          className="shrink-0 px-2 py-1 text-[16px] text-[var(--dim)]"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 border border-dashed border-[var(--border)] bg-[var(--surface)] px-4 py-5 text-center text-[14px] text-[var(--dim)]">
                  Nothing explained yet. Your one-pagers will live here so you
                  can pull one up before a call or a signing.
                </p>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
