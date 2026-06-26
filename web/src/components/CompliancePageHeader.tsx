export function CompliancePageHeader({
  kicker,
  title,
  subtitle,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="compliance-page-header mb-4 px-1">
      <p className="veritrail-kicker">{kicker}</p>
      <h1 className="text-xl font-semibold tracking-tight text-zinc-900 sm:text-2xl">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm leading-relaxed text-zinc-500">{subtitle}</p> : null}
    </header>
  );
}
