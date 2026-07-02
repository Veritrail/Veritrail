import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { api, formatApiError } from "../api";
import { useAppScrollLock } from "../lib/useAppScrollLock";

type IntegrationRequestModalProps = {
  open: boolean;
  onClose: () => void;
};

export function IntegrationRequestModal({ open, onClose }: IntegrationRequestModalProps) {
  const [integrationName, setIntegrationName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useAppScrollLock(open);

  const reset = useCallback(() => {
    setIntegrationName("");
    setMessage("");
    setError("");
  }, []);

  const submit = useMutation({
    mutationFn: () =>
      api("/v1/integrations/integration-request", {
        method: "POST",
        body: JSON.stringify({
          integration_name: integrationName.trim(),
          message: message.trim(),
        }),
      }),
    onSuccess: () => {
      setError("");
    },
    onError: (err: Error) => setError(formatApiError(err) || err.message),
  });

  const handleClose = useCallback(() => {
    if (submit.isPending) return;
    reset();
    submit.reset();
    onClose();
  }, [onClose, reset, submit]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !submit.isPending) handleClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, submit.isPending, handleClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]"
      onClick={() => !submit.isPending && handleClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="integration-request-title"
        className="w-full max-w-md rounded-2xl border border-zinc-200/90 bg-white p-6 shadow-xl shadow-zinc-900/10"
        onClick={(e) => e.stopPropagation()}
      >
        {submit.isSuccess ? (
          <div className="text-center">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 ring-1 ring-emerald-100">
              <span className="text-xl" aria-hidden>
                ✓
              </span>
            </div>
            <h2 id="integration-request-title" className="mt-4 text-base font-semibold tracking-tight text-zinc-950">
              Request sent
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
              We&apos;ve received your integration request and will follow up soon.
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="mt-6 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 id="integration-request-title" className="text-base font-semibold tracking-tight text-zinc-950">
              Request an integration
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-500">
              Tell us which tool you&apos;d like to connect. We&apos;ll reach out about availability and timeline.
            </p>

            <form
              className="mt-5 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (!integrationName.trim()) return;
                setError("");
                submit.mutate();
              }}
            >
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">Integration name</span>
                <input
                  type="text"
                  required
                  value={integrationName}
                  onChange={(e) => setIntegrationName(e.target.value)}
                  placeholder="e.g. ServiceNow, Datadog, PagerDuty"
                  className="mt-1.5 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-zinc-700">
                  Message <span className="font-normal text-zinc-400">(optional)</span>
                </span>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="What would you use this integration for?"
                  rows={3}
                  className="mt-1.5 w-full resize-none rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-100"
                />
              </label>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleClose}
                  disabled={submit.isPending}
                  className="rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!integrationName.trim() || submit.isPending}
                  className="rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submit.isPending ? "Sending…" : "Send request"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
