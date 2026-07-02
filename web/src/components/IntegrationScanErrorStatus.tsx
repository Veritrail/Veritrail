import { summarizeIntegrationScanError } from "../lib/scanFailureMessages";

type Props = {
  raw: string;
  className?: string;
};

/** Short inline scan-failure hint — full detail lives in notifications. */
export function IntegrationScanErrorStatus({ raw, className = "integration-setup__list-error" }: Props) {
  const summary = summarizeIntegrationScanError(raw);
  return (
    <div className={className}>
      Last scan failed — see notifications
      {summary ? ` · ${summary}` : null}
    </div>
  );
}
