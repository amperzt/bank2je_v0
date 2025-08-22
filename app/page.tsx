"use client";
import { useState } from "react";

type Row = { date?: string; description?: string; amount?: string; currency?: string };

export default function TestUpload() {
  const [status, setStatus] = useState<"idle"|"loading"|"ok"|"error">("idle");
  const [meta, setMeta] = useState<{kind?: string; bytes?: number}>({});
  const [rows, setRows] = useState<Row[]>([]);
  const [raw, setRaw] = useState<string>("");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setRows([]);
    setRaw("");
    setMeta({});

    try {
      const fd = new FormData(e.currentTarget);
      const res = await fetch("/api/parse-statement", { method: "POST", body: fd });
      const text = await res.text();           // read as text first (avoid double parse issues)
      setRaw(text.slice(0, 5000));

      let json: any;
      try { json = JSON.parse(text); } catch {
        throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
      }

      // Minimal shape guards
      const kind = json?.kind;
      const r = Array.isArray(json?.rows) ? json.rows : [];
      setMeta({ kind, bytes: (fd.get("file") as File)?.size });
      setRows(r);
      setStatus("ok");
    } catch (err: any) {
      console.error("[UI] upload error:", err);
      setStatus("error");
      setMeta({});
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

      <section className="text-sm">
        <div>status: <b>{status}</b></div>
        <div>kind: <b>{meta.kind ?? "-"}</b></div>
        <div>file bytes: <b>{meta.bytes ?? "-"}</b></div>
      </section>

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

      <section>
        <h2 className="font-semibold mb-2">Raw response (debug)</h2>
        <pre className="whitespace-pre-wrap text-xs border rounded p-2 max-h-72 overflow-auto">{raw}</pre>
      </section>
    </main>
  );
}
