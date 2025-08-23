"use client";
import { useState } from "react";

type Row = { date?: string; description?: string; amount?: string; currency?: string };

export default function TestUpload() {
  const [status, setStatus] = useState<"idle"|"loading"|"ok"|"error">("idle");
  const [kind, setKind] = useState<string>("-");
  const [rows, setRows] = useState<Row[]>([]);
  const [textPreview, setTextPreview] = useState<string>("");   // <— for PDF text
  const [warnings, setWarnings] = useState<string[]>([]);
  const [raw, setRaw] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setRows([]);
    setTextPreview("");
    setWarnings([]);
    setRaw("");
    setKind("-");

    const fd = new FormData(e.currentTarget as HTMLFormElement);
    try {
      const res = await fetch("/api/parse-statement", { method: "POST", body: fd });
      const bodyText = await res.text();
      setRaw(bodyText.slice(0, 5000));

      let json: any;
      try { json = JSON.parse(bodyText); } catch {
        throw new Error(`Non-JSON (${res.status}): ${bodyText.slice(0, 200)}`);
      }

      // error from API?
      if (!res.ok || json?.error) {
        setStatus("error");
        setKind(json?.kind ?? "-");
        setWarnings([]);
        return;
      }

      // handle both shapes: CSV/XLSX -> rows[], PDF -> text + warnings[]
      setKind(json.kind ?? "-");
      const r = Array.isArray(json.rows) ? json.rows : [];
      setRows(r);

      const text = typeof json.text === "string" ? json.text : "";
      setTextPreview(text);

      const w = Array.isArray(json.warnings) ? json.warnings : [];
      setWarnings(w);

      setStatus("ok");
    } catch (err) {
      console.error("[UI] upload error:", err);
      setStatus("error");
    }
  }

  return (
    <main className="p-6 space-y-4 max-w-4xl mx-auto">
      <form onSubmit={onSubmit} className="space-y-2">
        <input type="file" name="file" accept=".csv,.pdf,.xlsx" required />
        <button type="submit" disabled={status==="loading"} className="px-3 py-1 border rounded">
          {status === "loading" ? "Uploading…" : "Upload"}
        </button>
      </form>

      <section className="text-sm space-y-1">
        <div>status: <b>{status}</b></div>
        <div>kind: <b>{kind}</b></div>
        {warnings.length > 0 && (
          <div className="text-amber-700">
            <b>warnings:</b> {warnings.join(" • ")}
          </div>
        )}
      </section>

      {/* CSV/XLSX table */}
      {rows.length > 0 && (
        <section>
          <h2 className="font-semibold mb-2">Parsed rows ({rows.length})</h2>
          <div className="overflow-auto border rounded max-h-96 text-sm">
            <table className="min-w-full">
              <thead className="sticky top-0 bg-white">
                <tr>
                  <th className="text-left p-2 border-b">date</th>
                  <th className="text-left p-2 border-b">description</th>
                  <th className="text-right p-2 border-b">amount</th>
                  <th className="text-left p-2 border-b">currency</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="p-2 border-b">{r.date ?? ""}</td>
                    <td className="p-2 border-b">{r.description ?? ""}</td>
                    <td className="p-2 border-b text-right">{r.amount ?? ""}</td>
                    <td className="p-2 border-b">{r.currency ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* PDF text preview */}
      {textPreview && (
        <section>
          <h2 className="font-semibold mb-2">PDF text (preview)</h2>
          <pre className="whitespace-pre-wrap text-xs border rounded p-2 max-h-72 overflow-auto">
            {textPreview.slice(0, 4000)}
          </pre>
        </section>
      )}

      <section>
        <h2 className="font-semibold mb-2">Raw response (debug)</h2>
        <pre className="whitespace-pre-wrap text-xs border rounded p-2 max-h-72 overflow-auto">
          {raw}
        </pre>
      </section>
    </main>
  );
}
