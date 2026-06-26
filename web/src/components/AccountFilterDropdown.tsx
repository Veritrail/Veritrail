import { HistoryFilterDropdown } from "./HistoryFilterDropdown";
import { groupAccountId, ProviderMark, type AccountOption } from "./AccountSelect";
import "../styles/history-page.css";

/**
 * Account picker for Findings / Compliance. Reuses the same dropdown "card
 * family" as the History filters (labeled box + portalled checkmark menu) so
 * the account selector looks identical across every page.
 */
export function AccountFilterDropdown({
  accounts,
  value,
  onChange,
}: {
  accounts: AccountOption[];
  value: string;
  onChange: (id: string) => void;
}) {
  if (accounts.length === 0) return null;

  const current = accounts.find((a) => a.id === value) ?? accounts[0];
  const providerIcon = (provider: AccountOption["provider"], className: string) => (
    <ProviderMark provider={provider} className={className} />
  );

  return (
    <HistoryFilterDropdown
      label="Account"
      ariaLabel="Account"
      boxClassName="history-filter-box--account"
      value={value}
      options={accounts.map((a) => ({ value: a.id, label: a.label || groupAccountId(a.account_id ?? "") }))}
      onChange={onChange}
      valueIcon={providerIcon(current.provider, "history-filter-box__provider")}
      optionIcon={(optionValue) => {
        const account = accounts.find((a) => a.id === optionValue);
        return providerIcon(account?.provider, "history-filter-menu__icon history-filter-menu__provider");
      }}
    />
  );
}
