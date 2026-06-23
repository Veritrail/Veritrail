import { HistoryFilterDropdown } from "./HistoryFilterDropdown";
import "../styles/history-page.css";

export type WorkspaceEntry = { org_id: string; org_name: string; role: string };

function BuildingIcon({ className = "h-[18px] w-[18px]" }: { className?: string }) {
  return (
    <svg className={`${className} shrink-0 text-slate-400`} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 21V5.25A2.25 2.25 0 0 1 6.75 3h6a2.25 2.25 0 0 1 2.25 2.25V21m-10.5 0h15m-15 0H3m12 0h6m-10.5 0v-3.375c0-.621-.504-1.125-1.125-1.125h-.75c-.621 0-1.125.504-1.125 1.125V21m1.5-13.5h.008v.008H9V7.5Zm0 3h.008v.008H9V10.5Zm0 3h.008v.008H9V13.5Zm3-6h.008v.008H12V7.5Zm0 3h.008v.008H12V10.5Zm0 3h.008v.008H12V13.5Z" />
    </svg>
  );
}

/**
 * Switch between the workspaces (orgs) the signed-in user belongs to. Uses the
 * same dropdown "card family" as the account/history filters (labeled box +
 * chevron + checkmark menu), so it always shows the dropdown affordance — even
 * for a single workspace — and stays visually consistent across pages.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentOrgId,
  onSwitch,
  pending,
}: {
  workspaces: WorkspaceEntry[];
  currentOrgId: string;
  onSwitch: (id: string) => void;
  pending: boolean;
}) {
  if (workspaces.length === 0) return null;
  return (
    <div style={pending ? { opacity: 0.6, pointerEvents: "none" } : undefined}>
      <HistoryFilterDropdown
        label="Workspace"
        ariaLabel="Workspace"
        boxClassName="history-filter-box--workspace"
        value={currentOrgId}
        options={workspaces.map((w) => ({ value: w.org_id, label: w.org_name }))}
        onChange={(id) => {
          if (id && id !== currentOrgId) onSwitch(id);
        }}
        valueIcon={<BuildingIcon />}
        optionIcon={() => <BuildingIcon />}
      />
    </div>
  );
}
