import { absenceGapPrompt } from "../lib/evidenceGap";

export type CapabilityEnableItem = {
  checkId: string;
  capability: string;
  consoleUrl: string | null;
};

export function CapabilitiesToEnableList({ items }: { items: CapabilityEnableItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="org-home__capabilities-card">
      {items.map((item) => {
        const awsOption = absenceGapPrompt(item.checkId).awsOption;
        return (
          <div key={item.checkId} className="org-home__capability-row">
            <div className="org-home__capability-copy">
              <p className="org-home__capability-title">{item.capability}</p>
              <p className="org-home__capability-detail">{awsOption}</p>
            </div>
            {item.consoleUrl ? (
              <a
                href={item.consoleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="org-home__enable-btn"
              >
                Enable <span aria-hidden>→</span>
              </a>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
