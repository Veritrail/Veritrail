import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { FINDING_RESOURCE_BULK_CAP } from "../lib/findingResourceBulk";
import { JiraBulkFindingAction } from "./JiraFindingAction";

type BulkFinding = {
  id: string;
  check_id: string;
  resource_arn: string;
  title: string;
  severity: string;
  risk_score: number;
  status?: string;
  account_label?: string | null;
  evidence?: unknown;
  remediation_ticket_key?: string | null;
  remediation_ticket_url?: string | null;
};

type Props = {
  selectedFindings: BulkFinding[];
  onClear: () => void;
  onComplete?: () => void;
};

export function FindingResourceBulkBar({ selectedFindings, onClear, onComplete }: Props) {
  const qc = useQueryClient();
  const [bulkMode, setBulkMode] = useState<"actions" | "except">("actions");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkApprover, setBulkApprover] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const [jiraOpen, setJiraOpen] = useState(false);

  const count = selectedFindings.length;
  const overCap = count > FINDING_RESOURCE_BULK_CAP;

  const invalidateFindings = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: ["findings"] });
  }, [qc]);

  const runBulkExcept = useCallback(async () => {
    const reason = bulkReason.trim();
    const approver = bulkApprover.trim();
    if (!reason || !approver || overCap) return;

    setBulkBusy(true);
    setBulkMsg(null);
    const results = await Promise.allSettled(
      selectedFindings.map((finding) =>
        api(`/v1/findings/${finding.id}/exception`, {
          method: "POST",
          body: JSON.stringify({ reason, approved_by: approver, expires_at: null }),
        }),
      ),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    setBulkBusy(false);
    await invalidateFindings();
    if (failed > 0) {
      setBulkMsg(`${results.length - failed} excepted · ${failed} failed`);
    } else {
      setBulkMode("actions");
      setBulkReason("");
      setBulkApprover("");
      onClear();
      onComplete?.();
    }
  }, [
    bulkApprover,
    bulkReason,
    invalidateFindings,
    onClear,
    onComplete,
    overCap,
    selectedFindings,
  ]);

  return (
    <>
      <div
        className="finding-drawer-bulk-bar"
        role="toolbar"
        aria-label="Bulk resource actions"
      >
        <span className="finding-drawer-bulk-bar__count">
          {count.toLocaleString()} selected
        </span>
        {overCap ? (
          <span className="finding-drawer-bulk-bar__msg">
            Select at most {FINDING_RESOURCE_BULK_CAP} resources
          </span>
        ) : null}
        {bulkMode === "except" ? (
          <>
            <input
              className="finding-drawer-bulk-bar__input"
              placeholder="Exception reason…"
              value={bulkReason}
              onChange={(event) => setBulkReason(event.target.value)}
              autoFocus
            />
            <input
              className="finding-drawer-bulk-bar__input finding-drawer-bulk-bar__input--narrow"
              placeholder="Approved by…"
              value={bulkApprover}
              onChange={(event) => setBulkApprover(event.target.value)}
            />
            <button
              type="button"
              className="finding-drawer-bulk-bar__btn finding-drawer-bulk-bar__btn--primary"
              disabled={bulkBusy || !bulkReason.trim() || !bulkApprover.trim() || overCap}
              onClick={() => void runBulkExcept()}
            >
              {bulkBusy ? "Applying…" : "Confirm exception"}
            </button>
            <button
              type="button"
              className="finding-drawer-bulk-bar__btn"
              onClick={() => setBulkMode("actions")}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="finding-drawer-bulk-bar__btn"
              disabled={overCap}
              onClick={() => setBulkMode("except")}
            >
              Except selected
            </button>
            <button
              type="button"
              className="finding-drawer-bulk-bar__btn"
              disabled={overCap}
              onClick={() => setJiraOpen(true)}
            >
              Create tickets ▾
            </button>
            <button type="button" className="finding-drawer-bulk-bar__btn" onClick={onClear}>
              Clear
            </button>
          </>
        )}
        {bulkMsg ? <span className="finding-drawer-bulk-bar__msg">{bulkMsg}</span> : null}
      </div>
      <JiraBulkFindingAction
        findings={selectedFindings}
        open={jiraOpen}
        onClose={() => setJiraOpen(false)}
        onComplete={async () => {
          await invalidateFindings();
          onClear();
          onComplete?.();
        }}
      />
    </>
  );
}
