import { useState } from "react";
import { BASE, auditorToken } from "../api";

const FRAMEWORKS = [
  { key: "soc2", label: "SOC 2" },
  { key: "cis_aws_l1", label: "CIS AWS Foundations L1" },
];

export default function AuditorExport() {
  const [framework, setFramework] = useState("soc2");
  const [accountId, setAccountId] = useState("");
  const [period, setPeriod] = useState(90);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  async function handleDownload() {
    if (!accountId.trim()) {
      setError("Account ID is required.");
      return;
    }
    setError("");
    setDownloading(true);

    try {
      const t = auditorToken();
      const url = `${BASE}/auditor/export?framework=${framework}&account_id=${accountId.trim()}&period=${period}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Download failed");
      }
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `vigil-evidence-${framework}-auditor.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="w-full max-w-xl space-y-6 pb-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-950">Export Evidence Pack</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Download an auditor-watermarked evidence pack (ZIP + PDF + CSV).
        </p>
      </div>

      <div className="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">
        {/* Framework */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">Framework</label>
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700"
          >
            {FRAMEWORKS.map((fw) => (
              <option key={fw.key} value={fw.key}>{fw.label}</option>
            ))}
          </select>
        </div>

        {/* Account ID */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">AWS Account ID</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="e.g. a1b2c3d4-..."
            className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 font-mono"
          />
        </div>

        {/* Period */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-500">
            Period (days): {period}
          </label>
          <input
            type="range"
            min={7}
            max={365}
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="w-full accent-sky-500"
          />
          <div className="flex justify-between text-[11px] text-zinc-400">
            <span>7 days</span>
            <span>365 days</span>
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          onClick={handleDownload}
          disabled={downloading}
          className="w-full rounded-xl bg-indigo-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {downloading ? "Generating evidence pack…" : "Download Evidence Pack"}
        </button>

        <p className="text-[11px] text-zinc-400 text-center">
          This pack is logged in the audit activity trail and marked with an auditor watermark.
        </p>
      </div>
    </div>
  );
}
