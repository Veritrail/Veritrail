import { useState } from "react";
import { BASE, auditorToken } from "../api";
import { PackIntegrityPanel, packIntegrityFromResponse } from "../components/PackIntegrityPanel";
import "../styles/auditor.css";

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
  const [lastZipSha256, setLastZipSha256] = useState<string | null>(null);
  const [lastReportId, setLastReportId] = useState<string | null>(null);

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
      const integrity = packIntegrityFromResponse(res);
      if (integrity.zipSha256) setLastZipSha256(integrity.zipSha256);
      if (integrity.reportId) setLastReportId(integrity.reportId);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `veritrail-evidence-${framework}-auditor.zip`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="aud-page max-w-xl space-y-5 pb-8">
      <div>
        <h1 className="aud-title">Export Evidence Pack</h1>
        <p className="aud-subtitle">Download an auditor-watermarked evidence pack (ZIP + PDF + CSV).</p>
      </div>

      <div className="aud-card aud-card__pad space-y-4">
        {/* Framework */}
        <div>
          <label className="aud-field-label">Framework</label>
          <select value={framework} onChange={(e) => setFramework(e.target.value)} className="aud-select w-full">
            {FRAMEWORKS.map((fw) => (
              <option key={fw.key} value={fw.key}>{fw.label}</option>
            ))}
          </select>
        </div>

        {/* Account ID */}
        <div>
          <label className="aud-field-label">AWS Account ID</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="e.g. a1b2c3d4-…"
            className="aud-input font-mono"
          />
        </div>

        {/* Period */}
        <div>
          <label className="aud-field-label">Period (days): {period}</label>
          <input type="range" min={7} max={365} value={period} onChange={(e) => setPeriod(Number(e.target.value))} className="aud-range" />
          <div className="mt-1 flex justify-between text-[11px] text-zinc-400">
            <span>7 days</span>
            <span>365 days</span>
          </div>
        </div>

        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button onClick={handleDownload} disabled={downloading} className="aud-btn-primary">
          {downloading ? "Generating evidence pack…" : "Download Evidence Pack"}
        </button>

        <p className="text-center text-[11px] leading-relaxed text-zinc-400">
          This pack is logged in the audit activity trail and marked with an auditor watermark.
        </p>
      </div>

      <PackIntegrityPanel
        variant="auditor"
        zipSha256={lastZipSha256}
        reportId={lastReportId}
      />
    </div>
  );
}
