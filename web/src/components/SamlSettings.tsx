import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { settingsCardClass, Toggle } from "./SettingsUi";

type SamlConfig = {
  enabled: boolean;
  slug: string;
  idp_entity_id: string;
  idp_sso_url: string;
  idp_x509_cert: string;
  sp_entity_id: string;
  sp_acs_url: string;
  sp_metadata_url: string;
  login_url: string;
};

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-zinc-600">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-zinc-50 px-3 py-2 font-mono text-xs text-zinc-700 ring-1 ring-zinc-100">
          {value}
        </code>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="shrink-0 rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  const cls =
    "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 text-zinc-900 placeholder:text-zinc-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500/25";
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-semibold text-zinc-600">
        {label}
      </label>
      {textarea ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
          className={`${cls} font-mono text-xs`}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${cls} text-sm`}
        />
      )}
    </div>
  );
}

export function SamlSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<SamlConfig | null>({
    queryKey: ["saml-config"],
    queryFn: () => api("/v1/auth/saml/config"),
  });

  const [enabled, setEnabled] = useState(false);
  const [slug, setSlug] = useState("");
  const [entityId, setEntityId] = useState("");
  const [ssoUrl, setSsoUrl] = useState("");
  const [cert, setCert] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (isLoading || hydrated) return;
    if (data) {
      setEnabled(data.enabled);
      setSlug(data.slug);
      setEntityId(data.idp_entity_id);
      setSsoUrl(data.idp_sso_url);
      setCert(data.idp_x509_cert);
    }
    setHydrated(true);
  }, [data, isLoading, hydrated]);

  const mutation = useMutation({
    mutationFn: () =>
      api<SamlConfig>("/v1/auth/saml/config", {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          slug: slug.trim(),
          idp_entity_id: entityId.trim(),
          idp_sso_url: ssoUrl.trim(),
          idp_x509_cert: cert.trim(),
        }),
      }),
    onSuccess: (saved) => {
      setErr("");
      setMsg("Saved");
      setTimeout(() => setMsg(""), 2000);
      qc.setQueryData(["saml-config"], saved);
    },
    onError: (e: unknown) => setErr(e instanceof Error ? e.message : "Save failed"),
  });

  if (isLoading) return <p className="px-4 py-3 text-xs text-zinc-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className={settingsCardClass}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">Enable SAML SSO</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">
              Let members sign in through your identity provider (Entra ID, Google Workspace, etc.). IdP handles
              MFA. New users are provisioned into this workspace on first login.
            </p>
          </div>
          <Toggle checked={enabled} onChange={setEnabled} />
        </div>
        <div className="space-y-3 border-t border-zinc-100 px-4 py-3">
          <Field id="saml-slug" label="Organization slug (used in the login URL)" value={slug} onChange={setSlug} placeholder="acme" />
          <Field id="saml-entity" label="IdP entity ID / issuer" value={entityId} onChange={setEntityId} placeholder="https://idp.example.com/metadata" />
          <Field id="saml-sso" label="IdP SSO URL" value={ssoUrl} onChange={setSsoUrl} placeholder="https://idp.example.com/sso/saml" />
          <Field id="saml-cert" label="IdP x509 signing certificate" value={cert} onChange={setCert} placeholder="-----BEGIN CERTIFICATE-----" textarea />
        </div>
      </div>

      {data?.slug && (
        <div className={settingsCardClass}>
          <div className="border-b border-zinc-100 px-4 py-3">
            <p className="text-sm font-semibold text-zinc-900">Service provider details</p>
            <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">Give these to your IdP administrator.</p>
          </div>
          <div className="space-y-3 px-4 py-3">
            <CopyRow label="SP entity ID" value={data.sp_entity_id} />
            <CopyRow label="ACS (reply) URL" value={data.sp_acs_url} />
            <CopyRow label="Metadata URL" value={data.sp_metadata_url} />
            <CopyRow label="Login URL" value={data.login_url} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {mutation.isPending ? "Saving…" : "Save"}
        </button>
        {msg && <span className="text-xs font-medium text-emerald-600">{msg}</span>}
        {err && <span className="text-xs text-red-600">{err}</span>}
      </div>
    </div>
  );
}
