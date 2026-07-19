import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useSearchParams } from "react-router-dom";

import { api } from "../api";
import { AccountFilterDropdown } from "../components/AccountFilterDropdown";
import { CloudFeatureComingSoon } from "../components/CloudFeatureComingSoon";
import { ControlTimelineBoard } from "../components/ControlTimelineBoard";
import { HeaderFilterBar } from "../components/HeaderFilterBar";
import { HistoryFilterDropdown } from "../components/HistoryFilterDropdown";
import { ProductShell } from "../components/ProductShell";
import { HeaderSlot } from "../context/HeaderSlot";
import { useConnectedAccountOptions } from "../hooks/useConnectedAccountOptions";
import { useSelectedAccountId } from "../hooks/useSelectedAccountId";
import { compositeControlListSchema } from "../lib/apiSchemas";
import { isAwsCloudProvider } from "../lib/cloudProviderFeatures";
import { buildCompositeGroupScope } from "../lib/historyEvidence";
import "../styles/history-page.css";

const FRAMEWORKS = [
  { value: "soc2", label: "SOC 2" },
  { value: "cis_aws_l1", label: "CIS" },
  { value: "iso27001", label: "ISO 27001" },
] as const;

const PERIODS = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 180, label: "180 days" },
] as const;

const COMPOSITE_GROUP_ORDER = [
  "identity_governance",
  "asset_inventory",
  "secure_sdlc",
  "change_management",
  "data_protection",
  "network_boundary",
  "vulnerability_management",
  "logging_monitoring",
  "incident_response",
  "backup_resilience",
  "container_vulnerability_monitoring",
] as const;

export default function HistoryV2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [days, setDays] = useState(90);
  const [framework, setFramework] = useState(() => searchParams.get("framework") ?? "soc2");
  const [compositeFilter, setCompositeFilter] = useState(
    () => searchParams.get("composite") ?? "",
  );

  const {
    options: connectedAccounts,
    isLoading: accountsLoading,
    isSuccess: accountsReady,
  } = useConnectedAccountOptions();
  const {
    accountId: effectiveAccountId,
    activeAccount,
    setAccountId,
  } = useSelectedAccountId(connectedAccounts, accountsReady);
  const isAwsAccount = isAwsCloudProvider(activeAccount?.provider);

  const compositesQ = useQuery({
    queryKey: ["controls", "composites", effectiveAccountId],
    queryFn: () =>
      api(
        `/v1/controls/composites${effectiveAccountId ? `?account_id=${effectiveAccountId}` : ""}`,
        { schema: compositeControlListSchema },
      ),
    enabled: !!effectiveAccountId && isAwsAccount,
  });

  const compositeOptions = useMemo(() => {
    const order = new Map(COMPOSITE_GROUP_ORDER.map((id, index) => [id, index]));
    const rows = [...(compositesQ.data ?? [])].sort(
      (left, right) =>
        (order.get(left.id as (typeof COMPOSITE_GROUP_ORDER)[number]) ?? 99) -
        (order.get(right.id as (typeof COMPOSITE_GROUP_ORDER)[number]) ?? 99),
    );
    return [
      { value: "", label: "All groups" },
      ...rows.map((row) => ({ value: row.id, label: row.title })),
    ];
  }, [compositesQ.data]);

  const compositeGroupScope = useMemo(() => {
    if (!compositeFilter) return null;
    const composite = compositesQ.data?.find((row) => row.id === compositeFilter);
    if (!composite) return null;
    return buildCompositeGroupScope(composite);
  }, [compositeFilter, compositesQ.data]);

  useEffect(() => {
    setFramework(searchParams.get("framework") ?? "soc2");
    setCompositeFilter(searchParams.get("composite") ?? "");
  }, [searchParams]);

  function patchSearchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }

  if (accountsReady && !accountsLoading && connectedAccounts.length === 0) {
    return <Navigate to="/home" replace />;
  }

  return (
    <ProductShell className="flex flex-1 flex-col">
      <div className="history-page history-page--fill px-1 sm:px-0">
        <HeaderSlot>
          <HeaderFilterBar>
            <AccountFilterDropdown
              accounts={connectedAccounts}
              value={effectiveAccountId}
              onChange={setAccountId}
            />

            {isAwsAccount ? (
              <>
                <HistoryFilterDropdown
                  label="Period"
                  boxClassName="history-filter-dropdown--period"
                  ariaLabel="Period"
                  value={String(days)}
                  options={PERIODS.map((period) => ({
                    value: String(period.value),
                    label: period.label,
                  }))}
                  onChange={(value) => setDays(Number(value))}
                />

                <HistoryFilterDropdown
                  label="Framework"
                  boxClassName="history-filter-dropdown--framework"
                  ariaLabel="Framework"
                  value={framework}
                  options={FRAMEWORKS.map((item) => ({
                    value: item.value,
                    label: item.label,
                  }))}
                  onChange={(value) => {
                    setFramework(value);
                    patchSearchParams({ framework: value });
                  }}
                />

                <HistoryFilterDropdown
                  label="Group"
                  boxClassName="history-filter-dropdown--group"
                  ariaLabel="Compliance group"
                  value={compositeFilter}
                  options={compositeOptions}
                  onChange={(value) => {
                    setCompositeFilter(value);
                    patchSearchParams({ composite: value || null });
                  }}
                />
              </>
            ) : null}
          </HeaderFilterBar>
        </HeaderSlot>

        {!isAwsAccount && effectiveAccountId && activeAccount ? (
          <div className="cloud-feature-coming-soon-wrap">
            <CloudFeatureComingSoon page="history" provider={activeAccount.provider} />
          </div>
        ) : null}

        {isAwsAccount && effectiveAccountId ? (
          <div className="history-panel history-panel--fill">
            <div className="history-controls-wrap">
              <ControlTimelineBoard
                accountId={effectiveAccountId}
                framework={framework}
                days={days}
                checkIdFilter={compositeGroupScope?.checkIds ?? null}
              />
            </div>
          </div>
        ) : null}
      </div>
    </ProductShell>
  );
}
