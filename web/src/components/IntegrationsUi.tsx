import { Link } from "react-router-dom";
import { AWS_LOGO_LIGHT } from "../lib/awsBrand";
import { INTEGRATION_BRAND, type IntegrationBrandId } from "../lib/integrationBrands";

export function formatSync(value: string | null | undefined) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatRelativeAgo(value: string | null | undefined): string {
  if (!value) return "";
  const diffMs = Date.now() - new Date(value).getTime();
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function formatSyncDetail(value: string | null | undefined): { primary: string; secondary: string } {
  if (!value) return { primary: "—", secondary: "" };
  return {
    primary: formatSync(value),
    secondary: formatRelativeAgo(value),
  };
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function StatusDot({ tone }: { tone: "ok" | "warn" | "idle" | "sync" | "danger" }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500"
      : tone === "danger"
        ? "bg-red-500"
        : tone === "warn"
          ? "bg-amber-500"
          : tone === "sync"
            ? "bg-indigo-500 animate-pulse"
            : "bg-zinc-300";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${cls}`} />;
}

export function ProgressBar({
  value,
  tone = "ok",
  label,
}: {
  value: number;
  tone?: "ok" | "warn" | "neutral";
  label?: string;
}) {
  const bar =
    tone === "warn" ? "bg-amber-600" : tone === "neutral" ? "bg-zinc-400" : "bg-emerald-600";
  return (
    <div>
      {label && (
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-zinc-500">{label}</span>
          <span className="font-semibold tabular-nums text-zinc-800">{value}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-zinc-100 ring-1 ring-zinc-200/60">
        <div className={`h-full rounded-full transition-all ${bar}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}

export function CategorySection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
    </section>
  );
}

type OpStatus = { icon: React.ReactNode; label: string; value: string; tone: "ok" | "warn" | "idle" | "sync" };

export function OpStatusRow({ items }: { items: OpStatus[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-2.5 rounded-lg border border-zinc-100 bg-zinc-50/80 px-3 py-2.5"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-zinc-500 ring-1 ring-zinc-200/80">
            {item.icon}
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{item.label}</div>
            <div className="flex items-center gap-1.5 truncate text-xs font-medium text-zinc-800">
              <StatusDot tone={item.tone} />
              {item.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function CapabilityTags({ tags }: { tags: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="rounded-md bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-600 ring-1 ring-zinc-200/60"
        >
          {tag}
        </span>
      ))}
    </div>
  );
}

export type IntegrationCardModel = {
  name: string;
  category: string;
  description: string;
  icon: React.ReactNode;
  iconBg: string;
  href?: string;
  comingSoon?: boolean;
  connected?: boolean;
  syncing?: boolean;
  loading?: boolean;
  capabilities: string[];
  evidence?: { label: string; value: string | number }[];
  opStatus?: OpStatus[];
  primaryCta?: { label: string; href: string };
  secondaryCta?: { label: string; href: string };
};

export function IntegrationEcosystemCard({
  name,
  description,
  icon,
  iconBg,
  href,
  comingSoon,
  connected,
  syncing,
  loading,
  capabilities,
  evidence,
  opStatus,
  primaryCta,
  secondaryCta,
}: IntegrationCardModel) {
  const statusLabel = loading ? "—" : syncing ? "Syncing" : comingSoon ? "Coming soon" : connected ? "Connected" : "Not connected";
  const statusClass = syncing
    ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
    : connected
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : comingSoon
        ? "bg-zinc-50 text-zinc-400 ring-zinc-200"
        : "bg-zinc-100 text-zinc-500 ring-zinc-200";

  const ctaHref = primaryCta?.href ?? href;
  const ctaLabel = primaryCta?.label ?? (connected ? "Manage integration" : comingSoon ? "Coming soon" : "Connect");

  return (
    <div
      className={`flex min-h-[320px] flex-col rounded-2xl border bg-white shadow-sm shadow-zinc-950/[0.04] ${
        comingSoon ? "border-dashed border-zinc-200 opacity-75" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3.5">
            <span
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm ${iconBg} ${
                comingSoon ? "opacity-50 grayscale" : ""
              }`}
            >
              {icon}
            </span>
            <div className="min-w-0 pt-0.5">
              <h3 className="text-base font-bold text-zinc-950">{name}</h3>
              <p className="mt-0.5 text-xs leading-relaxed text-zinc-500">{description}</p>
            </div>
          </div>
          <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ring-1 ${statusClass}`}>
            {syncing && <Spinner className="h-3 w-3" />}
            {statusLabel}
          </span>
        </div>

        <div className="mt-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Capabilities</div>
          <CapabilityTags tags={capabilities} />
        </div>

        {evidence && evidence.length > 0 && !comingSoon && (
          <div className="mt-4">
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Evidence collected</div>
            <div className="grid grid-cols-3 gap-2">
              {evidence.map((e) => (
                <div key={e.label} className="rounded-lg border border-zinc-100 bg-zinc-50/80 px-2.5 py-2 text-center">
                  <div className="text-lg font-bold tabular-nums text-zinc-900">{e.value}</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">{e.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {opStatus && opStatus.length > 0 && !comingSoon && (
          <div className="mt-4 space-y-2">
            {opStatus.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-1.5 text-zinc-500">
                  <span className="text-zinc-400">{item.icon}</span>
                  {item.label}
                </span>
                <span className="flex items-center gap-1.5 font-medium text-zinc-800">
                  <StatusDot tone={item.tone} />
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        )}

        {syncing && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-indigo-100 bg-indigo-50/60 px-3 py-2 text-xs text-indigo-800">
            <Spinner className="h-3.5 w-3.5 shrink-0" />
            Collecting evidence…
          </div>
        )}
      </div>

      <div className="border-t border-zinc-100 p-4">
        {comingSoon ? (
          <button
            type="button"
            disabled
            className="flex w-full cursor-not-allowed items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2.5 text-sm font-semibold text-zinc-400"
          >
            Coming soon
          </button>
        ) : ctaHref ? (
          <div className="flex gap-2">
            <Link
              to={ctaHref}
              className="flex flex-1 items-center justify-center rounded-lg bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-zinc-800"
            >
              {ctaLabel}
            </Link>
            {secondaryCta && (
              <Link
                to={secondaryCta.href}
                className="flex items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50"
              >
                {secondaryCta.label}
              </Link>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ── Icons ── */

export function IntegrationBrandIcon({
  brand,
  size = 40,
  variant = "tile",
  className = "",
}: {
  brand: IntegrationBrandId;
  size?: number;
  variant?: "tile" | "plain";
  className?: string;
}) {
  const { src, fallback, tileScale = 1, tilePadding = 8 } = INTEGRATION_BRAND[brand];
  const img = (
    <img
      src={src}
      alt=""
      aria-hidden
      className="h-full w-full object-contain"
      decoding="async"
      loading="lazy"
      style={tileScale !== 1 ? { transform: `scale(${tileScale})` } : undefined}
      onError={
        fallback
          ? (event) => {
              if (event.currentTarget.src.endsWith(fallback)) return;
              event.currentTarget.src = fallback;
            }
          : undefined
      }
    />
  );

  const plainScale = brand === "gitlab" ? 1.22 : tileScale;

  if (variant === "plain") {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={src}
          alt=""
          aria-hidden
          className="h-full w-full object-contain"
          decoding="async"
          loading="lazy"
          style={plainScale !== 1 ? { transform: `scale(${plainScale})` } : undefined}
          onError={
            fallback
              ? (event) => {
                  if (event.currentTarget.src.endsWith(fallback)) return;
                  event.currentTarget.src = fallback;
                }
              : undefined
          }
        />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-sm shadow-zinc-950/[0.03] ${className}`}
      style={{ width: size, height: size, padding: tilePadding }}
    >
      {img}
    </span>
  );
}

export function GitHubMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2C6.477 2 2 6.593 2 12.253c0 4.526 2.862 8.368 6.839 9.724.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.184-1.11-1.5-1.11-1.5-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.566 2.341 1.114 2.91.852.091-.662.349-1.114.635-1.37-2.221-.259-4.555-1.139-4.555-5.068 0-1.12.39-2.034 1.029-2.751-.103-.26-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.051A9.358 9.358 0 0 1 12 6.949c.85.004 1.705.118 2.504.346 1.909-1.327 2.747-1.051 2.747-1.051.546 1.412.203 2.454.1 2.714.64.717 1.027 1.631 1.027 2.751 0 3.939-2.337 4.806-4.565 5.06.359.318.679.945.679 1.904 0 1.374-.013 2.483-.013 2.82 0 .274.18.594.688.493C19.14 20.617 22 16.778 22 12.253 22 6.593 17.523 2 12 2Z" />
    </svg>
  );
}

export function GitLabMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51a.42.42 0 0 1 .11-.18.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}

/** AWS wordmark on white tile — for light UI surfaces. */
export function AwsBrandIcon({ className = "h-11 w-11" }: { className?: string }) {
  return (
    <img
      src={AWS_LOGO_LIGHT}
      alt=""
      aria-hidden
      className={`rounded-xl object-contain ring-1 ring-zinc-200/80 ${className}`}
    />
  );
}

/** Framed AWS tile — matches Accounts page and other integration brand boxes. */
export function AwsBrandTile({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-xl border border-zinc-200/90 bg-white p-2 shadow-sm shadow-zinc-950/[0.03] ${className}`}
    >
      <img
        src={AWS_LOGO_LIGHT}
        alt=""
        aria-hidden
        className="h-full w-full object-contain"
        decoding="async"
      />
    </div>
  );
}

export function AwsMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M6.763 10.036c0 .296.032.535.088.717.064.183.144.368.24.535l.8-.5c-.16-.24-.288-.496-.384-.768a2.7 2.7 0 0 1-.144-.984c0-.88.296-1.576.896-2.088.6-.52 1.424-.776 2.472-.776.52 0 1.016.064 1.488.192.472.128.912.304 1.32.528l-.6.72a5.4 5.4 0 0 0-1.08-.384 4.2 4.2 0 0 0-.936-.104c-.64 0-1.128.144-1.464.432-.328.28-.496.68-.496 1.2 0 .224.032.424.096.6.064.168.16.336.288.504zm8.952 3.328c-.472.392-1.088.696-1.848.912a8.5 8.5 0 0 1-2.352.312c-.912 0-1.712-.12-2.4-.36a5.2 5.2 0 0 1-1.776-1.008 4.4 4.4 0 0 1-1.104-1.584 5.6 5.6 0 0 1-.384-2.088c0-.768.128-1.432.384-1.992.264-.568.616-1.04 1.056-1.416.448-.376.968-.656 1.56-.84a6.2 6.2 0 0 1 1.848-.288c.68 0 1.296.096 1.848.288.56.192 1.032.464 1.416.816l-.672.768a3.2 3.2 0 0 0-1.104-.6 4.1 4.1 0 0 0-1.344-.216c-.52 0-.984.088-1.392.264a2.4 2.4 0 0 0-.984.744 2.1 2.1 0 0 0-.36 1.224c0 .48.12.888.36 1.224.24.328.568.576.984.744.416.16.888.24 1.416.24.52 0 .984-.072 1.392-.216.416-.152.76-.36 1.032-.624l.672.768zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
    </svg>
  );
}

export function SlackMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zm8.694 0a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 22.57 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.52V8.834zm-1.27 0a2.527 2.527 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.758 0a2.528 2.528 0 0 1 2.523 2.522v6.312zm-2.523 8.694a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.758 24a2.528 2.528 0 0 1-2.523-2.522v-2.52h2.523z" />
    </svg>
  );
}

export function GcpMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12.02 10.18v3.72l3.32 1.92c.64-1.18 1.01-2.53 1.01-3.96 0-.52-.05-1.03-.14-1.52l-4.19-2.42v1.26zm-1.96-3.38L6.4 8.77A7.96 7.96 0 0 0 4 12c0 1.44.38 2.79 1.05 3.96l3.97-2.29V10.2l4.04-2.33v1.33zM12 4c-1.73 0-3.33.48-4.7 1.31l3.97 2.29 2.73-1.58V4zm6.98 4.77-3.97 2.29 2.73 1.58A7.96 7.96 0 0 1 20 12c0-1.18-.26-2.3-.72-3.31l-.3-.92zM12 20a7.97 7.97 0 0 0 4.7-1.53l-3.97-2.29-2.73 1.58V20z" />
    </svg>
  );
}

export function AzureMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M5.4 4.2h8.28l-1.02 5.58 5.94-2.78L8.9 19.8 7.2 12.6l-4.5 2.1L5.4 4.2z" />
    </svg>
  );
}

export function PagerDutyMark({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2zm0 3.2 5.2 2.9v5.8L12 16.8l-5.2-3V8.1L12 5.2z" />
    </svg>
  );
}

export function IconShield({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
    </svg>
  );
}

export function IconSync({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182" />
    </svg>
  );
}

export function IconClock({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

export function IconWebhook({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </svg>
  );
}

export function IconUsers({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </svg>
  );
}

export function IconGitMerge({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" d="M6 4.5v11" />
      <circle cx="18" cy="7" r="2.25" />
      <circle cx="6" cy="19" r="2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 10a9 9 0 0 1-9 9" />
    </svg>
  );
}

/** Git branch tree — /public/icons/git-repo.png via CSS mask */
export function IconRepo({ className = "scm-git-repo-icon" }: { className?: string }) {
  return <span className={className} aria-hidden />;
}

export function IconBranch({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6.878V6a2.25 2.25 0 0 1 2.25-2.25h7.5A2.25 2.25 0 0 1 18 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 0 0 4.5 9v.878m13.5-3A2.25 2.25 0 0 1 19.5 9v.878m0 0a2.25 2.25 0 0 0-2.25 2.25v5.25a2.25 2.25 0 0 0 2.25 2.25h.75a2.25 2.25 0 0 0 2.25-2.25v-5.25a2.25 2.25 0 0 0-2.25-2.25h-.75Z" />
    </svg>
  );
}
