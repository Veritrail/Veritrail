import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { accountListSchema } from "../lib/apiSchemas";
import { useAppScrollLock } from "../lib/useAppScrollLock";

type RotateExternalIdAccount = {
  id: string;
  label: string;
  external_id?: string | null;
  pending_external_id?: string | null;
};

type RotateExternalIdResponse = {
  pending_external_id: string;
  external_id_rotation_requested_at: string;
  cfn_update_cli_command: string;
  account: RotateExternalIdAccount;
};

type RotateExternalIdModalProps = {
  accountId: string | null;
  accountLabel?: string;
  open: boolean;
  onClose: () => void;
};

function truncateToken(value: string, head = 18, tail = 8): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function RotateExternalIdModal({
  accountId,
  accountLabel,
  open,
  onClose,
}: RotateExternalIdModalProps) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "pending" | "done">("idle");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cliCommand, setCliCommand] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");

  useAppScrollLock(open);

  const accountQuery = useQuery({
    queryKey: ["accounts"],
    queryFn: () => api("/v1/accounts", { schema: accountListSchema }),
    enabled: open && !!accountId,
    staleTime: 15_000,
  });

  const account = (accountQuery.data ?? []).find((a) => a.id === accountId) as
    | RotateExternalIdAccount
    | undefined;
  const label = account?.label ?? accountLabel ?? "AWS account";
  const currentExternalId = account?.external_id ?? "";

  useEffect(() => {
    if (!open) return;
    setError("");
    setCopied(false);
    setCliCommand(null);
    if (account?.pending_external_id) {
      setPhase("pending");
      setPendingId(account.pending_external_id);
    } else {
      setPhase("idle");
      setPendingId(null);
    }
  }, [open, accountId, account?.pending_external_id]);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["cloud-accounts"] });
  }, [qc]);

  const startRotation = useMutation({
    mutationFn: () =>
      api<RotateExternalIdResponse>(`/v1/accounts/${accountId}/rotate-external-id`, {
        method: "POST",
      }),
    onSuccess: (data) => {
      setError("");
      setPendingId(data.pending_external_id);
      setCliCommand(data.cfn_update_cli_command);
      setPhase("pending");
      invalidate();
    },
    onError: (err: Error) => setError(formatApiError(err) || err.message),
  });

  const confirmRotation = useMutation({
    mutationFn: () =>
      api(`/v1/accounts/${accountId}/confirm-external-id-rotation`, { method: "POST" }),
    onSuccess: () => {
      setError("");
      setPhase("done");
      invalidate();
    },
    onError: (err: Error) => setError(formatApiError(err) || err.message),
  });

  const cancelRotation = useMutation({
    mutationFn: () =>
      api(`/v1/accounts/${accountId}/cancel-external-id-rotation`, { method: "POST" }),
    onSuccess: () => {
      setError("");
      setPhase("idle");
      setPendingId(null);
      setCliCommand(null);
      invalidate();
      onClose();
    },
    onError: (err: Error) => setError(formatApiError(err) || err.message),
  });

  const busy =
    startRotation.isPending || confirmRotation.isPending || cancelRotation.isPending;

  const handleClose = useCallback(() => {
    if (busy) return;
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy, handleClose]);

  async function copyCli() {
    if (!cliCommand) return;
    await navigator.clipboard.writeText(cliCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!open || !accountId) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center"
      role="presentation"
      onClick={handleClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rotate-external-id-title"
        className="flex max-h-[min(90vh,40rem)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/15"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-100 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 id="rotate-external-id-title" className="text-base font-semibold text-zinc-900">
                Rotate External ID
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">{label}</p>
            </div>
            <button
              type="button"
              onClick={handleClose}
              disabled={busy}
              className="shrink-0 rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {accountQuery.isLoading && !account ? (
            <p className="text-sm text-zinc-500">Loading account…</p>
          ) : phase === "done" ? (
            <p className="text-sm leading-relaxed text-zinc-600">
              External ID rotation confirmed. Scans will use the new External ID going forward.
            </p>
          ) : phase === "idle" ? (
            <>
              <p className="text-sm leading-relaxed text-zinc-600">
                Mint a new External ID, update your CloudFormation stack trust condition, then confirm
                Veritrail can assume the role with the new value. The current ID stays active until
                confirmation.
              </p>
              {currentExternalId ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50/80 px-3 py-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                    Current External ID
                  </p>
                  <p className="mt-1 font-mono text-sm text-zinc-800" title={currentExternalId}>
                    {truncateToken(currentExternalId)}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <ol className="list-decimal space-y-2 pl-4 text-sm leading-relaxed text-zinc-600">
                <li>Update the connector stack with the new ExternalId parameter (CLI below).</li>
                <li>Wait for the stack update to finish in AWS.</li>
                <li>Confirm rotation so Veritrail switches to the new ID.</li>
              </ol>
              <div className="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  New External ID
                </p>
                <p className="mt-1 break-all font-mono text-sm font-semibold text-amber-950">
                  {pendingId}
                </p>
              </div>
              {cliCommand ? (
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">
                      CloudFormation update CLI
                    </p>
                    <button
                      type="button"
                      onClick={copyCli}
                      className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                    >
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <pre className="max-h-40 overflow-auto rounded-lg border border-zinc-200 bg-zinc-950 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-zinc-100">
                    {cliCommand}
                  </pre>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">
                  Click Load update CLI to fetch the CloudFormation command for the pending External ID.
                </p>
              )}
            </>
          )}

          {error ? (
            <p className="text-sm text-red-600" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-100 px-5 py-3">
          {phase === "done" ? (
            <button
              type="button"
              onClick={handleClose}
              className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Done
            </button>
          ) : phase === "idle" ? (
            <>
              <button
                type="button"
                onClick={handleClose}
                disabled={busy}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => startRotation.mutate()}
                disabled={busy || accountQuery.isLoading}
                className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {startRotation.isPending ? "Starting…" : "Start rotation"}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => cancelRotation.mutate()}
                disabled={busy}
                className="mr-auto rounded-lg px-3.5 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
              >
                {cancelRotation.isPending ? "Cancelling…" : "Cancel rotation"}
              </button>
              {!cliCommand ? (
                <button
                  type="button"
                  onClick={() => startRotation.mutate()}
                  disabled={busy}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                >
                  {startRotation.isPending ? "Loading…" : "Load update CLI"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => confirmRotation.mutate()}
                disabled={busy}
                className="rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
              >
                {confirmRotation.isPending ? "Verifying…" : "Confirm rotation"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
