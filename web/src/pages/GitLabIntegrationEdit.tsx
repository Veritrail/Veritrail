import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { GitLabMark, Spinner } from "../components/IntegrationsUi";

type GitLabProvider = {
  username: string | null;
  group_id: string | null;
  group_ids: string[];
  base_url: string | null;
  selected_repos: string[];
};

type GitLabGroup = {
  full_path: string;
  name: string;
};

type GitLabRepo = {
  path_with_namespace: string;
  visibility: string;
  default_branch: string | null;
};

export default function GitLabIntegrationEdit() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const justConnected = searchParams.get("connected") === "1";
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [repoFilter, setRepoFilter] = useState("");

  const provider = useQuery({
    queryKey: ["gitlab-provider"],
    queryFn: () => api<GitLabProvider | null>("/v1/integrations/gitlab"),
  });

  const groups = useQuery({
    queryKey: ["gitlab-groups"],
    queryFn: () => api<GitLabGroup[]>("/v1/integrations/gitlab/groups"),
    enabled: !!provider.data,
  });

  useEffect(() => {
    if (!provider.data) return;
    const owners = provider.data.group_ids?.length ? provider.data.group_ids : provider.data.group_id ? [provider.data.group_id] : [];
    setGroupIds(owners);
    setSelectedRepos(provider.data.selected_repos || []);
  }, [provider.data]);

  const repos = useQuery({
    queryKey: ["gitlab-repos", groupIds],
    queryFn: async () => {
      const lists = await Promise.all(
        groupIds.map((ns) => api<GitLabRepo[]>(`/v1/integrations/gitlab/repos?namespace=${encodeURIComponent(ns)}`))
      );
      return lists.flat();
    },
    enabled: !!provider.data && groupIds.length > 0,
  });

  const selectedSet = useMemo(() => new Set(selectedRepos), [selectedRepos]);
  const availableGroups = useMemo(() => {
    const discovered = (groups.data || []).map((g) => g.full_path);
    return Array.from(new Set([...discovered, ...groupIds])).filter(Boolean);
  }, [groupIds, groups.data]);
  const groupNameMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups.data || []) map[g.full_path] = g.name;
    return map;
  }, [groups.data]);
  const filteredRepos = useMemo(() => {
    const query = repoFilter.trim().toLowerCase();
    if (!query) return repos.data || [];
    return (repos.data || []).filter((repo) => repo.path_with_namespace.toLowerCase().includes(query));
  }, [repoFilter, repos.data]);
  const groupedRepos = useMemo(() => {
    return filteredRepos.reduce<Record<string, GitLabRepo[]>>((groupsByNamespace, repo) => {
      const namespace = repo.path_with_namespace.split("/")[0] || "Other";
      groupsByNamespace[namespace] = groupsByNamespace[namespace] || [];
      groupsByNamespace[namespace].push(repo);
      return groupsByNamespace;
    }, {});
  }, [filteredRepos]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/gitlab/scope", {
        method: "PUT",
        body: JSON.stringify({
          group_id: groupIds[0] || null,
          group_ids: groupIds,
          selected_repos: selectedRepos,
          base_url: provider.data?.base_url || null,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["gitlab-provider"] });
      navigate("/integrations/gitlab");
    },
  });

  function toggleRepo(name: string) {
    setSelectedRepos((current) =>
      current.length === 0
        ? (repos.data || []).map((repo) => repo.path_with_namespace).filter((repo) => repo !== name)
        : current.includes(name)
          ? current.filter((repo) => repo !== name)
          : [...current, name]
    );
  }

  function toggleGroup(path: string) {
    if (groupIds.includes(path)) {
      setGroupIds((current) => current.filter((group) => group !== path));
      setSelectedRepos((current) => current.filter((repo) => !repo.toLowerCase().startsWith(`${path.toLowerCase()}/`)));
      return;
    }
    setGroupIds((current) => [...current, path]);
  }

  if (provider.isLoading) {
    return <div className="mx-auto max-w-5xl text-sm text-zinc-500">Loading GitLab integration...</div>;
  }

  if (!provider.data) {
    return (
      <div className="mx-auto max-w-5xl rounded-lg border border-zinc-200 bg-white p-6">
        <h1 className="text-xl font-semibold text-zinc-950">GitLab is not connected</h1>
        <p className="mt-2 text-sm text-zinc-600">Connect GitLab before choosing scope.</p>
        <Link to="/integrations/gitlab" className="mt-5 inline-flex rounded-lg bg-[#e24329] px-4 py-2 text-sm font-medium text-white hover:bg-[#c93a22]">
          Back to GitLab
        </Link>
      </div>
    );
  }

  const instanceLabel = provider.data.base_url ? provider.data.base_url.replace(/^https?:\/\//, "") : "gitlab.com";

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-10">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Source control</p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.03em] text-zinc-950">Configure GitLab access</h1>
      </div>

      {justConnected && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          GitLab connected. Select at least one group below, then save to start syncing.
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#e24329] text-white">
              <GitLabMark className="h-6 w-6" />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-zinc-950">Source access</h2>
              <p className="mt-1 text-sm text-zinc-500">Authenticated as {provider.data.username || "GitLab user"} on {instanceLabel}</p>
            </div>
          </div>
        </div>

        <div className="mt-6">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-zinc-950">Connected sources</div>
              <div className="mt-1 text-sm text-zinc-500">Choose which GitLab groups can feed this workspace.</div>
            </div>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-600">{groupIds.length} selected</div>
          </div>
          {groups.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(groups.error as Error).message}</div>}
          {!!availableGroups.length && (
            <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200">
              {availableGroups.map((path) => (
                <label key={path} className="flex cursor-pointer items-center justify-between gap-4 bg-white px-4 py-3 hover:bg-zinc-50">
                  <div>
                    <div className="text-sm font-medium text-zinc-950">{groupNameMap[path] || path}</div>
                    <div className="mt-1 text-xs text-zinc-500">{path}</div>
                  </div>
                  <input type="checkbox" checked={groupIds.includes(path)} onChange={() => toggleGroup(path)} className="h-4 w-4 rounded border-zinc-300 text-[#e24329] focus:ring-[#e24329]" />
                </label>
              ))}
            </div>
          )}
          {!groups.isLoading && !availableGroups.length && <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-5 text-sm text-zinc-500">No GitLab groups found. Make sure the token has at least Reporter access to the target groups.</div>}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-zinc-950">Repository scope</h2>
            <p className="mt-1 text-sm text-zinc-500">Leave empty to include every repository under the selected groups.</p>
          </div>
          <button onClick={() => setSelectedRepos([])} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
            Include all repositories
          </button>
        </div>

        <div className="mt-5">
          <input type="search" value={repoFilter} onChange={(event) => setRepoFilter(event.target.value)} placeholder="Filter repositories..." className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-100" />
        </div>

        {repos.isLoading && (
          <div className="mt-6 flex justify-center py-8">
            <Spinner className="h-6 w-6 text-zinc-400" />
          </div>
        )}
        {repos.error && <div className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(repos.error as Error).message}</div>}
        {repos.data && (
          <div className="mt-4 max-h-[420px] overflow-auto rounded-lg border border-zinc-200">
            {Object.entries(groupedRepos).map(([namespace, namespaceRepos]) => (
              <div key={namespace}>
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-4 py-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{namespace}</div>
                  <div className="text-xs text-zinc-500">{namespaceRepos.length} repositories</div>
                </div>
                <div className="divide-y divide-zinc-100">
                  {namespaceRepos.map((repo) => (
                    <label key={repo.path_with_namespace} className="group flex cursor-pointer items-center justify-between gap-4 px-4 py-2.5 transition-colors hover:bg-zinc-50">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-950">{repo.path_with_namespace}</div>
                        <div className="mt-0.5 text-xs text-zinc-500">{repo.visibility} · default branch {repo.default_branch || "unknown"}</div>
                      </div>
                      <input type="checkbox" checked={!selectedRepos.length || selectedSet.has(repo.path_with_namespace)} onChange={() => toggleRepo(repo.path_with_namespace)} className="h-4 w-4 shrink-0 rounded border-zinc-300 text-[#e24329] transition-colors group-hover:border-orange-400 focus:ring-[#e24329]" />
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {!!repos.data.length && !filteredRepos.length && <div className="px-4 py-6 text-sm text-zinc-500">No repositories match this filter.</div>}
            {!repos.data.length && <div className="px-4 py-6 text-sm text-zinc-500">No repositories found for this group.</div>}
          </div>
        )}
      </div>

      {save.error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{(save.error as Error).message}</div>}

      <div className="flex justify-end gap-3">
        <Link to="/integrations/gitlab" className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50">
          Cancel
        </Link>
        <button onClick={() => save.mutate()} disabled={save.isPending || !groupIds.length} className="rounded-lg bg-[#e24329] px-5 py-2 text-sm font-medium text-white hover:bg-[#c93a22] disabled:opacity-60">
          {save.isPending ? "Saving..." : "Save scope"}
        </button>
      </div>
    </div>
  );
}
