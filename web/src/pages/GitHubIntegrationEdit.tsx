import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

type GitHubProvider = {
  login: string | null;
  org_login: string | null;
  org_logins: string[];
  selected_repos: string[];
};

type GitHubOrg = {
  login: string;
};

type GitHubRepo = {
  full_name: string;
  private: boolean;
  default_branch: string | null;
};

function GitHubMark({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M12 2C6.477 2 2 6.593 2 12.253c0 4.526 2.862 8.368 6.839 9.724.5.095.683-.222.683-.494 0-.244-.009-.89-.014-1.747-2.782.62-3.369-1.375-3.369-1.375-.455-1.184-1.11-1.5-1.11-1.5-.908-.636.069-.623.069-.623 1.004.072 1.532 1.057 1.532 1.057.892 1.566 2.341 1.114 2.91.852.091-.662.349-1.114.635-1.37-2.221-.259-4.555-1.139-4.555-5.068 0-1.12.39-2.034 1.029-2.751-.103-.26-.446-1.302.098-2.714 0 0 .84-.276 2.75 1.051A9.358 9.358 0 0 1 12 6.949c.85.004 1.705.118 2.504.346 1.909-1.327 2.747-1.051 2.747-1.051.546 1.412.203 2.454.1 2.714.64.717 1.027 1.631 1.027 2.751 0 3.939-2.337 4.806-4.565 5.06.359.318.679.945.679 1.904 0 1.374-.013 2.483-.013 2.82 0 .274.18.594.688.493C19.14 20.617 22 16.778 22 12.253 22 6.593 17.523 2 12 2Z" />
    </svg>
  );
}

export default function GitHubIntegrationEdit() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get("connected") === "1";
  const [orgLogins, setOrgLogins] = useState<string[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [repoFilter, setRepoFilter] = useState("");

  const provider = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api<GitHubProvider | null>("/v1/integrations/github"),
  });

  const orgs = useQuery({
    queryKey: ["github-orgs"],
    queryFn: () => api<GitHubOrg[]>("/v1/integrations/github/orgs"),
    enabled: !!provider.data,
  });

  const manageAccess = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/github/manage-url"),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

  useEffect(() => {
    if (!provider.data) return;
    const owners = provider.data.org_logins?.length
      ? provider.data.org_logins
      : provider.data.org_login
        ? [provider.data.org_login]
        : provider.data.login
          ? [provider.data.login]
          : [];
    setOrgLogins(owners);
    setSelectedRepos(provider.data.selected_repos || []);
  }, [provider.data]);

  const repos = useQuery({
    queryKey: ["github-repos", orgLogins],
    queryFn: async () => {
      const lists = await Promise.all(
        orgLogins.map((owner) => api<GitHubRepo[]>(`/v1/integrations/github/repos?owner=${encodeURIComponent(owner)}`))
      );
      return lists.flat();
    },
    enabled: !!provider.data && orgLogins.length > 0,
  });

  const selectedSet = useMemo(() => new Set(selectedRepos), [selectedRepos]);
  const availableOwners = useMemo(() => {
    const discovered = (orgs.data || []).map((org) => org.login);
    return Array.from(new Set([...discovered, ...orgLogins])).filter(Boolean);
  }, [orgLogins, orgs.data]);
  const filteredRepos = useMemo(() => {
    const query = repoFilter.trim().toLowerCase();
    if (!query) return repos.data || [];
    return (repos.data || []).filter((repo) => repo.full_name.toLowerCase().includes(query));
  }, [repoFilter, repos.data]);
  const groupedRepos = useMemo(() => {
    return filteredRepos.reduce<Record<string, GitHubRepo[]>>((groups, repo) => {
      const owner = repo.full_name.split("/")[0] || "Other";
      groups[owner] = groups[owner] || [];
      groups[owner].push(repo);
      return groups;
    }, {});
  }, [filteredRepos]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/github/scope", {
        method: "PUT",
        body: JSON.stringify({
          org_login: orgLogins[0] || null,
          org_logins: orgLogins,
          selected_repos: selectedRepos,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["github-provider"] });
      navigate("/integrations/github");
    },
  });

  function toggleRepo(fullName: string) {
    setSelectedRepos((current) =>
      current.length === 0
        ? (repos.data || []).map((repo) => repo.full_name).filter((repo) => repo !== fullName)
        : current.includes(fullName)
          ? current.filter((repo) => repo !== fullName)
          : [...current, fullName]
    );
  }

  function toggleOwner(owner: string) {
    if (orgLogins.includes(owner)) {
      setOrgLogins((current) => current.filter((item) => item !== owner));
      setSelectedRepos((current) => current.filter((repo) => !repo.toLowerCase().startsWith(`${owner.toLowerCase()}/`)));
      return;
    }
    setOrgLogins((current) => [...current, owner]);
  }

  if (provider.isLoading) {
    return <div className="mx-auto max-w-5xl text-sm text-zinc-500">Loading GitHub integration...</div>;
  }

  if (!provider.data) {
    return (
      <div className="mx-auto max-w-5xl rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-zinc-950">GitHub is not connected</h1>
        <p className="mt-2 text-sm text-zinc-600">Connect GitHub before choosing evidence scope.</p>
        <Link
          to="/integrations/github"
          className="mt-5 inline-flex rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800"
        >
          Back to GitHub evidence
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div>
        <p className="text-sm font-medium text-sky-700">Integrations / GitHub evidence</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-zinc-950">Edit evidence scope</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
          Choose which connected GitHub sources and repositories should feed compliance identity and change-management evidence.
        </p>
      </div>

      {justConnected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitHub connected. Select at least one organization below, then save to start syncing evidence.
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-950 text-white">
            <GitHubMark className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">Source access</h2>
            <p className="mt-1 text-sm text-zinc-500">Authenticated as {provider.data.login || "GitHub user"}</p>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-950">Connected GitHub sources</div>
              <div className="mt-1 text-sm text-zinc-600">
                Add or remove organization access in GitHub, then return here to choose the evidence scope.
              </div>
            </div>
            <button
              onClick={() => manageAccess.mutate()}
              disabled={manageAccess.isPending}
              className="inline-flex items-center rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
            >
              {manageAccess.isPending ? "Opening GitHub..." : "Manage GitHub permissions"}
              {!manageAccess.isPending && <span className="ml-2" aria-hidden="true">↗</span>}
            </button>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-sm font-medium text-zinc-700">Available sources</div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-600">
              {orgLogins.length} {orgLogins.length === 1 ? "selected" : "selected"}
            </div>
          </div>
          {orgs.isLoading && <div className="text-sm text-zinc-500">Loading GitHub sources...</div>}
          {orgs.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {(orgs.error as Error).message}
            </div>
          )}
          {!!availableOwners.length && (
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200">
              {availableOwners.map((owner) => (
                <label key={owner} className="flex cursor-pointer items-center justify-between gap-4 bg-white px-4 py-3 hover:bg-zinc-50">
                  <div>
                    <div className="text-sm font-medium text-zinc-950">{owner}</div>
                    <div className="mt-1 text-xs text-zinc-500">
                      {owner === provider.data?.login ? "Personal account" : "GitHub organization"}
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={orgLogins.includes(owner)}
                    onChange={() => toggleOwner(owner)}
                    className="h-4 w-4 rounded border-zinc-300 text-sky-600 focus:ring-sky-500"
                  />
                </label>
              ))}
            </div>
          )}
          {!orgs.isLoading && !availableOwners.length && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">
              No GitHub sources are visible yet. Manage access in GitHub and return to refresh this list.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">Repositories</h2>
            <p className="mt-1 text-sm text-zinc-500">Leave empty to include every repository under the selected owners.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setSelectedRepos([])}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Include all repositories
            </button>
          </div>
        </div>

        <div className="mt-5">
          <input
            type="search"
            value={repoFilter}
            onChange={(event) => setRepoFilter(event.target.value)}
            placeholder="Filter repositories..."
            className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
          />
        </div>

        {repos.isLoading && <div className="mt-6 text-sm text-zinc-500">Loading repositories...</div>}
        {repos.error && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {(repos.error as Error).message}
          </div>
        )}
        {repos.data && (
          <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border border-zinc-200">
            {Object.entries(groupedRepos).map(([owner, ownerRepos]) => (
              <div key={owner}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{owner}</div>
                  <div className="text-xs text-zinc-500">{ownerRepos.length} repositories</div>
                </div>
                <div className="divide-y divide-zinc-100">
                  {ownerRepos.map((repo) => (
                    <label key={repo.full_name} className="group flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-950">{repo.full_name}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {repo.private ? "Private" : "Public"} · default branch {repo.default_branch || "unknown"}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={!selectedRepos.length || selectedSet.has(repo.full_name)}
                        onChange={() => toggleRepo(repo.full_name)}
                        className="h-4 w-4 shrink-0 rounded border-zinc-300 text-sky-600 transition-colors group-hover:border-sky-400 focus:ring-sky-500"
                      />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!!repos.data.length && !filteredRepos.length && (
              <div className="px-4 py-6 text-sm text-zinc-500">No repositories match this filter.</div>
            )}
            {!repos.data.length && <div className="px-4 py-6 text-sm text-zinc-500">No repositories found for this owner.</div>}
          </div>
        )}
      </div>

      {save.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {(save.error as Error).message}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Link
          to="/integrations/github"
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          Cancel
        </Link>
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !orgLogins.length}
          className="rounded-lg bg-sky-600 px-5 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
        >
          {save.isPending ? "Saving..." : "Save scope"}
        </button>
      </div>
    </div>
  );
}
