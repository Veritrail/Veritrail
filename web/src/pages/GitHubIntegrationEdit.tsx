import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GitHubMark, IconUsers, Spinner } from "../components/IntegrationsUi";
import "../styles/scope-editor.css";

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

function RepoGlyph({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.04A9 9 0 0 0 6 3.75c-1.05 0-2.06.18-3 .51v14.25A9 9 0 0 1 6 18c2.3 0 4.41.87 6 2.29m0-14.25A9 9 0 0 1 18 3.75c1.05 0 2.06.18 3 .51v14.25A9 9 0 0 0 18 18a9 9 0 0 0-6 2.29m0-14.25v14.25" />
    </svg>
  );
}

function ShieldIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.96 11.96 0 0 1 3.6 6 12 12 0 0 0 3 9.75c0 5.6 3.82 10.3 9 11.62 5.18-1.33 9-6.03 9-11.62 0-1.31-.21-2.57-.6-3.75h-.15A11.96 11.96 0 0 1 12 2.71Z" />
    </svg>
  );
}

function ExternalIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18Z" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" aria-hidden>
      <circle cx="6" cy="6" r="2.25" />
      <circle cx="6" cy="18" r="2.25" />
      <circle cx="18" cy="8" r="2.25" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 8.25v7.5M18 10.25a6 6 0 0 1-6 6h-1.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path strokeLinecap="round" d="m20 20-3-3" />
    </svg>
  );
}

function CheckBadgeIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12 2.5 2.5 4.5-5" />
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
      window.location.assign(url);
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

  const totalRepoCount = repos.data?.length ?? 0;
  const selectedRepoCount = selectedRepos.length === 0 ? totalRepoCount : selectedRepos.length;
  const allFullNames = useMemo(() => (repos.data ?? []).map((r) => r.full_name), [repos.data]);
  const allChecked = selectedRepos.length === 0 || (allFullNames.length > 0 && allFullNames.every((n) => selectedSet.has(n)));

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
        <p className="mt-2 text-sm text-zinc-600">Connect GitHub before choosing scope.</p>
        <Link to="/integrations/github" className="mt-5 inline-flex rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800">
          Back to GitHub
        </Link>
      </div>
    );
  }

  const scopeError = orgs.error || repos.error;

  return (
    <div className="scope-edit space-y-6">
      <p className="scope-edit__breadcrumb">
        <Link to="/integrations">Integrations</Link>
        {" / "}Source control
      </p>

      <header className="scope-edit__header">
        <div className="min-w-0">
          <h1 className="scope-edit__title">Configure GitHub access</h1>
          <p className="scope-edit__subtitle">Select GitHub owners and repositories Veritrail can scan and monitor.</p>
        </div>
        <button onClick={() => manageAccess.mutate()} disabled={manageAccess.isPending} className="scope-edit__manage-btn">
          <ShieldIcon />
          {manageAccess.isPending ? "Opening GitHub…" : "Manage GitHub permissions"}
          {!manageAccess.isPending && <ExternalIcon />}
        </button>
      </header>

      {scopeError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(scopeError as Error).message}</div>
      )}

      {justConnected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitHub connected. Select at least one owner below, then save to start syncing.
        </div>
      )}

      <div className="scope-stats">
        <div className="scope-stat">
          <span className="scope-stat__icon scope-stat__icon--blue">
            <IconUsers className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="scope-stat__label">Connected owners</div>
            <div className="scope-stat__value">{orgLogins.length}</div>
            <div className="scope-stat__sub">Selected</div>
          </div>
        </div>
        <div className="scope-stat">
          <span className="scope-stat__icon scope-stat__icon--green">
            <RepoGlyph className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="scope-stat__label">Selected repositories</div>
            <div className="scope-stat__value">{selectedRepoCount}</div>
            <div className="scope-stat__sub">Selected</div>
          </div>
        </div>
        <div className="scope-stat">
          <span className="scope-stat__icon scope-stat__icon--purple">
            <ShieldIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <div className="scope-stat__label">Total repositories</div>
            <div className="scope-stat__value">{totalRepoCount}</div>
            <div className="scope-stat__sub">Found across selected owners</div>
          </div>
        </div>
      </div>

      <div className="scope-grid">
        <section className="scope-card">
          <h2 className="scope-card__title">1. Source access</h2>
          <p className="scope-card__subtitle">Choose which GitHub owners can feed this workspace.</p>

          {!!availableOwners.length && (
            <div className="scope-owners">
              {availableOwners.map((owner) => (
                <label key={owner} className="scope-owner-row">
                  <span className="scope-owner-row__mark">
                    <GitHubMark className="h-4 w-4" />
                  </span>
                  <div className="scope-owner-row__text">
                    <div className="scope-owner-row__name">{owner}</div>
                    <div className="scope-owner-row__meta">{owner === provider.data?.login ? "Personal account" : "Organization"}</div>
                  </div>
                  <input
                    type="checkbox"
                    className="scope-checkbox"
                    checked={orgLogins.includes(owner)}
                    onChange={() => toggleOwner(owner)}
                  />
                </label>
              ))}
            </div>
          )}

          <button onClick={() => manageAccess.mutate()} disabled={manageAccess.isPending} className="scope-add-owner">
            Add another owner
          </button>

          {!orgs.isLoading && !availableOwners.length && (
            <p className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4 text-sm text-zinc-500">
              No GitHub sources are visible yet. Manage access in GitHub and return to refresh this list.
            </p>
          )}

          {provider.data.login && (
            <div className="scope-auth-pill">
              <CheckBadgeIcon />
              Authenticated as {provider.data.login}
            </div>
          )}
        </section>

        <section className="scope-card">
          <div className="scope-card__head-row">
            <div className="min-w-0">
              <h2 className="scope-card__title">2. Repository scope</h2>
              <p className="scope-card__subtitle">Choose the repositories Veritrail should scan under the selected owners.</p>
            </div>
            <button onClick={() => setSelectedRepos([])} className="scope-btn-outline">
              Include all repositories
            </button>
          </div>

          <div className="scope-filter-row">
            <label className="scope-search">
              <SearchIcon />
              <input
                type="search"
                value={repoFilter}
                onChange={(event) => setRepoFilter(event.target.value)}
                placeholder="Filter repositories…"
                aria-label="Filter repositories"
              />
            </label>
            <span className="scope-repo-count">
              {filteredRepos.length} {filteredRepos.length === 1 ? "repository" : "repositories"}
            </span>
          </div>

          {repos.isLoading ? (
            <div className="mt-6 flex justify-center py-8">
              <Spinner className="h-6 w-6 text-zinc-400" />
            </div>
          ) : (
            <div className="scope-repo-table-wrap">
              <table className="scope-repo-table">
                <thead>
                  <tr>
                    <th>Repository</th>
                    <th>Visibility</th>
                    <th>Default branch</th>
                    <th>
                      <input
                        type="checkbox"
                        className="scope-checkbox"
                        checked={allChecked}
                        onChange={() => setSelectedRepos([])}
                        aria-label="Select all repositories"
                        title="Select all"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRepos.map((repo) => (
                    <tr key={repo.full_name}>
                      <td>
                        <div className="scope-repo-cell">
                          <RepoGlyph className="h-4 w-4" />
                          <span className="scope-repo-cell__name">{repo.full_name}</span>
                        </div>
                      </td>
                      <td>
                        <span className="scope-vis">
                          {repo.private ? <LockIcon /> : <GlobeIcon />}
                          {repo.private ? "Private" : "Public"}
                        </span>
                      </td>
                      <td>
                        <span className="scope-branch">
                          <BranchIcon />
                          {repo.default_branch || "—"}
                        </span>
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="scope-checkbox"
                          checked={!selectedRepos.length || selectedSet.has(repo.full_name)}
                          onChange={() => toggleRepo(repo.full_name)}
                          aria-label={`Include ${repo.full_name}`}
                        />
                      </td>
                    </tr>
                  ))}
                  {!!repos.data?.length && !filteredRepos.length && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-zinc-500">
                        No repositories match this filter.
                      </td>
                    </tr>
                  )}
                  {!repos.data?.length && (
                    <tr>
                      <td colSpan={4} className="py-6 text-center text-sm text-zinc-500">
                        No repositories found for the selected owners.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {save.error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">{(save.error as Error).message}</p>
          )}

          <div className="scope-card__actions">
            <Link to="/integrations/github" className="scope-btn-outline">
              Cancel
            </Link>
            <button onClick={() => save.mutate()} disabled={save.isPending || !orgLogins.length} className="scope-btn-primary">
              <ShieldIcon />
              {save.isPending ? "Saving…" : "Save scope"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
