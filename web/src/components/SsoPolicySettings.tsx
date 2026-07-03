import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { settingsSchema } from "../lib/apiSchemas";
import { settingsCardClass, Toggle } from "./SettingsUi";

export function SsoPolicySettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api("/v1/settings", { schema: settingsSchema }),
  });

  const patchM = useMutation({
    mutationFn: (sso_required: boolean) =>
      api("/v1/settings", {
        method: "PATCH",
        body: JSON.stringify({ security: { sso_required } }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });

  const enabled = Boolean(data?.security?.sso_required);

  return (
    <div className={`${settingsCardClass} space-y-3 p-4`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900">Require SSO sign-in</p>
          <p className="mt-1 text-xs text-zinc-500">
            When enabled, password login and password reset are disabled for this workspace. Existing
            password sessions are ended on refresh.
          </p>
        </div>
        <Toggle
          checked={enabled}
          disabled={isLoading || patchM.isPending}
          onChange={(next) => patchM.mutate(next)}
          aria-label="Require SSO sign-in"
        />
      </div>
      {enabled ? (
        <p className="text-xs text-amber-700">
          SAML must be configured before members can sign in. Use your IdP login URL from SAML settings.
        </p>
      ) : null}
    </div>
  );
}
