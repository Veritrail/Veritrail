import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "../api";
import { iacRepositoryIntegrationSchema, integrationStatusNullableSchema } from "../lib/apiSchemas";
import { IntegrationBrandIcon } from "../components/IntegrationsUi";
import type { IntegrationBrandId } from "../lib/integrationBrands";
import "../styles/integration-setup.css";

type VcsProvider = "github" | "gitlab" | "azure_devops" | "codecommit";
type RepoMode = "single" | "dual";
type WizardStep = 1 | 2 | 3 | 4;

const VCS_OPTIONS: {
  id: VcsProvider;
  label: string;
  brand: IntegrationBrandId;
  authHint: string;
}[] = [
  { id: "github", label: "GitHub", brand: "github", authHint: "Uses your existing GitHub connection — pick an owner and repository, same as Configure GitHub access." },
  { id: "gitlab", label: "GitLab", brand: "gitlab", authHint: "Reuses GitLab OAuth when no token is set." },
  {
    id: "azure_devops",
    label: "Azure DevOps",
    brand: "azure-devops",
    authHint: "Provide org URL and personal access token.",
  },
  { id: "codecommit", label: "AWS CodeCommit", brand: "aws", authHint: "Provide repository name and Git credentials." },
];

const STEP_LABELS = ["Provider", "Terragrunt", "Layout", "Link repos"] as const;
const FLOW_NODES = [
  { title: "Findings", detail: "Cloud issue" },
  { title: "Remediation", detail: "Fix plan" },
  { title: "IaC PR", detail: "Reviewed change" },
] as const;

function repoLinkCallout(vcs: VcsProvider, providerLabel: string): string {
  switch (vcs) {
    case "github":
      return `Enter owner and repo only — not a full https://github.com/… URL. Veritrail connects over HTTPS to ${providerLabel}'s API (OAuth or token) and assembles the repository from your provider choice plus those fields.`;
    case "gitlab":
      return `Enter the group/project path (e.g. acme-corp/infrastructure) — not a browser URL. Veritrail connects over HTTPS to ${providerLabel}'s API (OAuth or token) and resolves the project from that path.`;
    case "azure_devops":
      return `Enter org/project/repo — not a full Azure DevOps web URL. Veritrail connects over HTTPS to Azure DevOps using your token and builds the repository from that reference.`;
    case "codecommit":
      return `Enter the repository name — not an AWS console or clone URL. Veritrail connects over HTTPS to CodeCommit using your Git credentials.`;
  }
}

type RepoForm = {
  owner: string;
  repo: string;
  repoRef: string;
  path: string;
  accessToken: string;
  baseUrl: string;
  authMethod: string;
  installationId: string;
  installationAccount: string;
  repositoryId: string;
};

function emptyRepoForm(): RepoForm {
  return {
    owner: "",
    repo: "",
    repoRef: "",
    path: ".",
    accessToken: "",
    baseUrl: "",
    authMethod: "",
    installationId: "",
    installationAccount: "",
    repositoryId: "",
  };
}

type GitHubAppRepo = {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string | null;
  html_url: string | null;
};

function VerifiedSuccessCard() {
  return (
    <div className="integration-setup__verified" role="status" aria-live="polite">
      <span className="integration-setup__verified-icon" aria-hidden>
        <svg className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="m8.5 12 2.5 2.5 4.5-5" />
        </svg>
      </span>
      <p className="integration-setup__verified-label">Verified</p>
    </div>
  );
}

function splitRepoFullName(fullName: string): { owner: string; repo: string } {
  const [owner = "", repo = ""] = fullName.split("/");
  return { owner, repo };
}

type GitHubOAuthRepo = {
  full_name: string;
  private: boolean;
  default_branch: string | null;
};

type GitHubOAuthOrg = {
  login: string;
};

function GitHubConnectCard({
  isAppConfigured,
  connectPending,
  connectError,
  onConnect,
}: {
  isAppConfigured: boolean;
  connectPending: boolean;
  connectError: string;
  onConnect: () => void;
}) {
  return (
    <div className="integration-setup__github-app-card">
      <div>
        <p className="integration-setup__github-app-eyebrow">GitHub connection required</p>
        <h3>Connect GitHub first</h3>
        <p>
          Link the same GitHub account you use for source-control evidence. You&apos;ll pick an owner and repository on
          the next screen — no separate GitHub App install is required.
        </p>
        {connectError ? <p className="integration-setup__error">{connectError}</p> : null}
      </div>
      <div className="integration-setup__github-connect-actions">
        <button
          type="button"
          className="integration-setup__btn integration-setup__btn--primary"
          onClick={onConnect}
          disabled={connectPending}
        >
          {connectPending ? "Opening GitHub…" : "Connect GitHub"}
        </button>
        <Link to="/integrations/github/edit" className="integration-setup__btn">
          Configure GitHub access
        </Link>
      </div>
      {isAppConfigured ? (
        <p className="integration-setup__field-hint">
          Or install the Veritrail GitHub App below if you prefer repository-scoped app access.
        </p>
      ) : null}
    </div>
  );
}

function GitHubOAuthRepositoryPicker({
  title,
  form,
  onChange,
  oauthLogin,
  initialOrgLogins,
  filter,
  onFilterChange,
  pathLabel,
  pathPlaceholder,
}: {
  title: string;
  form: RepoForm;
  onChange: (next: RepoForm) => void;
  oauthLogin?: string | null;
  initialOrgLogins: string[];
  filter: string;
  onFilterChange: (value: string) => void;
  pathLabel: string;
  pathPlaceholder: string;
}) {
  const [orgLogins, setOrgLogins] = useState<string[]>(initialOrgLogins);

  useEffect(() => {
    setOrgLogins(initialOrgLogins);
  }, [initialOrgLogins]);

  const orgs = useQuery({
    queryKey: ["github-orgs"],
    queryFn: () => api<GitHubOAuthOrg[]>("/v1/integrations/github/orgs"),
  });

  const repos = useQuery({
    queryKey: ["github-repos", orgLogins],
    queryFn: async () => {
      const lists = await Promise.all(
        orgLogins.map((owner) => api<GitHubOAuthRepo[]>(`/v1/integrations/github/repos?owner=${encodeURIComponent(owner)}`))
      );
      return lists.flat();
    },
    enabled: orgLogins.length > 0,
  });

  const availableOwners = useMemo(() => {
    const discovered = (orgs.data || []).map((org) => org.login);
    return Array.from(new Set([...discovered, ...orgLogins])).filter(Boolean);
  }, [orgLogins, orgs.data]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const rows = repos.data || [];
    if (!q) return rows;
    return rows.filter((repo) => repo.full_name.toLowerCase().includes(q));
  }, [filter, repos.data]);

  function toggleOwner(owner: string) {
    if (orgLogins.includes(owner)) {
      const nextOwners = orgLogins.filter((item) => item !== owner);
      setOrgLogins(nextOwners);
      if (form.repoRef.toLowerCase().startsWith(`${owner.toLowerCase()}/`)) {
        onChange({
          ...form,
          owner: "",
          repo: "",
          repoRef: "",
          authMethod: "oauth",
          installationId: "",
          installationAccount: "",
          repositoryId: "",
        });
      }
      return;
    }
    setOrgLogins((current) => [...current, owner]);
  }

  function selectRepo(repo: GitHubOAuthRepo) {
    const parts = splitRepoFullName(repo.full_name);
    onChange({
      ...form,
      owner: parts.owner,
      repo: parts.repo,
      repoRef: repo.full_name,
      accessToken: "",
      authMethod: "oauth",
      installationId: "",
      installationAccount: parts.owner,
      repositoryId: "",
    });
  }

  return (
    <div className="integration-setup__github-picker">
      <div className="integration-setup__github-picker-head">
        <div>
          <p className="integration-setup__github-app-eyebrow">GitHub connected</p>
          <h3>{title}</h3>
          <p>
            {oauthLogin
              ? `Authenticated as ${oauthLogin}. Pick an owner and repository — same flow as Configure GitHub access.`
              : "Pick an owner and repository from your connected GitHub account."}
          </p>
        </div>
        <Link to="/integrations/github/edit" className="integration-setup__btn">
          Manage access
        </Link>
      </div>

      {availableOwners.length > 0 ? (
        <div className="integration-setup__github-owner-list">
          <p className="integration-setup__field-label">Owners</p>
          <div className="integration-setup__github-owner-chips">
            {availableOwners.map((owner) => {
              const selected = orgLogins.includes(owner);
              return (
                <button
                  key={owner}
                  type="button"
                  className={`integration-setup__github-owner-chip${selected ? " is-selected" : ""}`}
                  onClick={() => toggleOwner(owner)}
                  aria-pressed={selected}
                >
                  {owner}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <label className="integration-setup__field-label" htmlFor={`${title}-repo-filter`}>
        Repository
      </label>
      <input
        id={`${title}-repo-filter`}
        className="integration-setup__input"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Search repositories..."
        disabled={!orgLogins.length}
      />
      <div className="integration-setup__repo-picker-list">
        {!orgLogins.length ? (
          <p className="integration-setup__repo-picker-empty">Select at least one owner to list repositories.</p>
        ) : null}
        {orgLogins.length > 0 && repos.isLoading ? (
          <p className="integration-setup__repo-picker-empty">Loading repositories...</p>
        ) : null}
        {orgLogins.length > 0 && !repos.isLoading && filtered.length === 0 ? (
          <p className="integration-setup__repo-picker-empty">No repositories match this search.</p>
        ) : null}
        {orgLogins.length > 0 &&
          !repos.isLoading &&
          filtered.slice(0, 80).map((repo) => {
            const selected = form.repoRef === repo.full_name;
            return (
              <button
                type="button"
                key={repo.full_name}
                className={`integration-setup__repo-picker-row${selected ? " is-selected" : ""}`}
                onClick={() => selectRepo(repo)}
                aria-pressed={selected}
              >
                <span>
                  <strong>{repo.full_name}</strong>
                  <small>
                    {repo.private ? "Private" : "Public"}
                    {repo.default_branch ? ` · ${repo.default_branch}` : ""}
                  </small>
                </span>
                <span className="integration-setup__repo-picker-check">{selected ? "Selected" : "Select"}</span>
              </button>
            );
          })}
      </div>

      <div className="integration-setup__field--wide">
        <label className="integration-setup__field-label">{pathLabel}</label>
        <input
          className="integration-setup__input"
          placeholder={pathPlaceholder}
          value={form.path}
          onChange={(e) => onChange({ ...form, path: e.target.value })}
        />
        <p className="integration-setup__field-hint">Folder inside the selected repository where files live.</p>
      </div>
    </div>
  );
}

function GitHubAppRepositoryPicker({
  title,
  form,
  onChange,
  repos,
  isLoading,
  isInstalled,
  isConfigured,
  account,
  installationId,
  manageUrl,
  installPending,
  installError,
  onInstall,
  filter,
  onFilterChange,
  pathLabel,
  pathPlaceholder,
}: {
  title: string;
  form: RepoForm;
  onChange: (next: RepoForm) => void;
  repos: GitHubAppRepo[];
  isLoading: boolean;
  isInstalled: boolean;
  isConfigured: boolean;
  account?: string | null;
  installationId?: string | null;
  manageUrl?: string | null;
  installPending: boolean;
  installError: string;
  onInstall: () => void;
  filter: string;
  onFilterChange: (value: string) => void;
  pathLabel: string;
  pathPlaceholder: string;
}) {
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter((repo) => repo.full_name.toLowerCase().includes(q));
  }, [filter, repos]);

  function selectRepo(repo: GitHubAppRepo) {
    const parts = splitRepoFullName(repo.full_name);
    onChange({
      ...form,
      owner: parts.owner,
      repo: parts.repo,
      repoRef: repo.full_name,
      accessToken: "",
      authMethod: "github_app",
      installationId: installationId || form.installationId,
      installationAccount: account || parts.owner,
      repositoryId: String(repo.id),
    });
  }

  if (!isConfigured) {
    return (
      <div className="integration-setup__github-app-card integration-setup__github-app-card--warning">
        <h3>{title}</h3>
        <p>GitHub App installation is not configured for this Veritrail environment.</p>
      </div>
    );
  }

  if (!isInstalled) {
    return (
      <div className="integration-setup__github-app-card">
        <div>
          <p className="integration-setup__github-app-eyebrow">GitHub App required</p>
          <h3>{title}</h3>
          <p>
            Install Veritrail on the GitHub account that owns your IaC repository, then select exactly which
            repositories Veritrail can access.
          </p>
          {installError ? <p className="integration-setup__error">{installError}</p> : null}
        </div>
        <button
          type="button"
          className="integration-setup__btn integration-setup__btn--primary"
          onClick={onInstall}
          disabled={installPending}
        >
          {installPending ? "Opening GitHub..." : "Install GitHub App"}
        </button>
      </div>
    );
  }

  return (
    <div className="integration-setup__github-picker">
      <div className="integration-setup__github-picker-head">
        <div>
          <p className="integration-setup__github-app-eyebrow">GitHub App installed</p>
          <h3>{title}</h3>
          <p>{account ? `Repository access is scoped to ${account}.` : "Repository access is scoped by the GitHub App installation."}</p>
        </div>
        {manageUrl ? (
          <a className="integration-setup__btn" href={manageUrl} target="_blank" rel="noreferrer">
            Manage access
          </a>
        ) : null}
      </div>

      <label className="integration-setup__field-label" htmlFor={`${title}-repo-filter`}>
        Repository
      </label>
      <input
        id={`${title}-repo-filter`}
        className="integration-setup__input"
        value={filter}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="Search authorized repositories..."
      />
      <div className="integration-setup__repo-picker-list">
        {isLoading ? <p className="integration-setup__repo-picker-empty">Loading repositories...</p> : null}
        {!isLoading && filtered.length === 0 ? (
          <p className="integration-setup__repo-picker-empty">No authorized repositories match this search.</p>
        ) : null}
        {!isLoading &&
          filtered.slice(0, 80).map((repo) => {
            const selected = form.repoRef === repo.full_name;
            return (
              <button
                type="button"
                key={repo.id}
                className={`integration-setup__repo-picker-row${selected ? " is-selected" : ""}`}
                onClick={() => selectRepo(repo)}
                aria-pressed={selected}
              >
                <span>
                  <strong>{repo.full_name}</strong>
                  <small>{repo.private ? "Private" : "Public"}{repo.default_branch ? ` · ${repo.default_branch}` : ""}</small>
                </span>
                <span className="integration-setup__repo-picker-check">{selected ? "Selected" : "Select"}</span>
              </button>
            );
          })}
      </div>

      <div className="integration-setup__field--wide">
        <label className="integration-setup__field-label">{pathLabel}</label>
        <input
          className="integration-setup__input"
          placeholder={pathPlaceholder}
          value={form.path}
          onChange={(e) => onChange({ ...form, path: e.target.value })}
        />
        <p className="integration-setup__field-hint">Folder inside the selected repository where files live.</p>
      </div>
    </div>
  );
}

function RepoFields({
  vcs,
  form,
  onChange,
  pathLabel,
  pathPlaceholder,
  pathHint = "Folder inside the repo where files live — separate from the owner/repo or project path.",
}: {
  vcs: VcsProvider;
  form: RepoForm;
  onChange: (next: RepoForm) => void;
  pathLabel: string;
  pathPlaceholder: string;
  pathHint?: string;
}) {
  const set = (patch: Partial<RepoForm>) => onChange({ ...form, ...patch });
  return (
    <div className="integration-setup__grid integration-setup__grid--2">
      {vcs === "github" ? (
        <>
          <div>
            <label className="integration-setup__field-label">Owner</label>
            <input
              className="integration-setup__input"
              placeholder="e.g. acme-corp"
              value={form.owner}
              onChange={(e) => set({ owner: e.target.value })}
            />
          </div>
          <div>
            <label className="integration-setup__field-label">Repo</label>
            <input
              className="integration-setup__input"
              placeholder="e.g. terraform-live"
              value={form.repo}
              onChange={(e) => set({ repo: e.target.value })}
            />
          </div>
        </>
      ) : vcs === "gitlab" ? (
        <>
          <div className="integration-setup__field--wide">
            <label className="integration-setup__field-label">Project path</label>
            <input
              className="integration-setup__input"
              placeholder="e.g. acme-corp/infrastructure"
              value={form.repoRef}
              onChange={(e) => set({ repoRef: e.target.value })}
            />
          </div>
          <div className="integration-setup__field--wide">
            <label className="integration-setup__field-label">GitLab base URL (optional)</label>
            <input
              className="integration-setup__input"
              placeholder="https://gitlab.com"
              value={form.baseUrl}
              onChange={(e) => set({ baseUrl: e.target.value })}
            />
          </div>
        </>
      ) : (
        <div className="integration-setup__field--wide">
          <label className="integration-setup__field-label">Repository reference</label>
          <input
            className="integration-setup__input"
            placeholder={vcs === "azure_devops" ? "org/project/repo" : "repo-name"}
            value={form.repoRef}
            onChange={(e) => set({ repoRef: e.target.value })}
          />
        </div>
      )}
      <div>
        <label className="integration-setup__field-label">{pathLabel}</label>
        <input
          className="integration-setup__input"
          placeholder={pathPlaceholder}
          value={form.path}
          onChange={(e) => set({ path: e.target.value })}
        />
        {pathHint ? <p className="integration-setup__field-hint">{pathHint}</p> : null}
      </div>
      {(vcs === "github" || vcs === "gitlab" || vcs === "azure_devops" || vcs === "codecommit") && (
        <div>
          <label className="integration-setup__field-label">Access token (optional)</label>
          <input
            type="password"
            className="integration-setup__input"
            value={form.accessToken}
            onChange={(e) => set({ accessToken: e.target.value })}
          />
        </div>
      )}
    </div>
  );
}

export default function IacRepositoryIntegration() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isManageMode = searchParams.get("manage") === "1";
  const { data, isLoading } = useQuery({
    queryKey: ["iac-repository-integration"],
    queryFn: () => api("/v1/integrations/iac-repository", { schema: iacRepositoryIntegrationSchema }),
  });

  const [step, setStep] = useState<WizardStep>(1);
  const [showVerified, setShowVerified] = useState(false);
  const [vcsProvider, setVcsProvider] = useState<VcsProvider>("github");
  const [usesTerragrunt, setUsesTerragrunt] = useState(false);
  const [repoMode, setRepoMode] = useState<RepoMode>("single");
  const [terraformForm, setTerraformForm] = useState<RepoForm>(emptyRepoForm());
  const [terragruntForm, setTerragruntForm] = useState<RepoForm>(emptyRepoForm());
  const [samePaths, setSamePaths] = useState(true);
  const [labels, setLabels] = useState("");
  const [saveError, setSaveError] = useState("");
  const [githubRepoFilter, setGithubRepoFilter] = useState("");
  const [githubTerragruntRepoFilter, setGithubTerragruntRepoFilter] = useState("");
  const [githubInstallError, setGithubInstallError] = useState("");
  const [githubConnectError, setGithubConnectError] = useState("");

  const githubProvider = useQuery({
    queryKey: ["github-provider"],
    queryFn: () => api("/v1/integrations/github", { schema: integrationStatusNullableSchema }),
    enabled: vcsProvider === "github",
  });

  const githubOAuthOrgLogins = useMemo(() => {
    const provider = githubProvider.data;
    if (!provider) return [];
    if (provider.org_logins?.length) return provider.org_logins;
    if (provider.org_login) return [provider.org_login];
    if (provider.login) return [provider.login];
    return [];
  }, [githubProvider.data]);

  const usesGithubOAuth = vcsProvider === "github" && !!githubProvider.data;
  const usesGithubAppFallback = vcsProvider === "github" && !githubProvider.data && !!data?.github_app_configured;

  const connectGithub = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/github/connect-url"),
    onSuccess: ({ url }) => {
      setGithubConnectError("");
      window.location.assign(url);
    },
    onError: (e) => setGithubConnectError(formatApiError(e)),
  });

  const githubAppRepos = useQuery({
    queryKey: ["iac-repository-github-app-repos", data?.github_app_installation_id],
    queryFn: () => api<GitHubAppRepo[]>("/v1/integrations/iac-repository/github-app/repositories"),
    enabled: usesGithubAppFallback && !!data?.github_app_installed,
  });

  const installGithubApp = useMutation({
    mutationFn: () => api<{ url: string }>("/v1/integrations/iac-repository/github-app/install-url"),
    onSuccess: ({ url }) => {
      setGithubInstallError("");
      window.location.assign(url);
    },
    onError: (e) => setGithubInstallError(formatApiError(e)),
  });

  useEffect(() => {
    if (!showVerified) return;
    const id = window.setTimeout(() => navigate("/integrations", { replace: true }), 1500);
    return () => window.clearTimeout(id);
  }, [showVerified, navigate]);

  useEffect(() => {
    if (!data?.connected || !isManageMode) return;
    if (data.vcs_provider) setVcsProvider(data.vcs_provider);
    setUsesTerragrunt(!!data.uses_terragrunt);
    setRepoMode(data.repo_mode ?? "single");
    const tf = data.terraform_repo;
    if (tf) {
      setTerraformForm({
        owner: tf.owner ?? "",
        repo: tf.repo ?? "",
        repoRef: tf.repo_ref ?? "",
        path: tf.path ?? data.terraform_path ?? ".",
        accessToken: "",
        baseUrl: tf.base_url ?? "",
        authMethod: tf.auth_method ?? "",
        installationId: tf.installation_id ?? data.github_app_installation_id ?? "",
        installationAccount: tf.installation_account ?? data.github_app_account ?? "",
        repositoryId: tf.repository_id ?? "",
      });
    }
    const tg = data.terragrunt_repo;
    if (tg?.repo_ref) {
      setTerragruntForm({
        owner: tg.owner ?? "",
        repo: tg.repo ?? "",
        repoRef: tg.repo_ref ?? "",
        path: tg.path ?? data.terragrunt_path ?? ".",
        accessToken: "",
        baseUrl: tg.base_url ?? "",
        authMethod: tg.auth_method ?? "",
        installationId: tg.installation_id ?? data.github_app_installation_id ?? "",
        installationAccount: tg.installation_account ?? data.github_app_account ?? "",
        repositoryId: tg.repository_id ?? "",
      });
    } else if (data.terragrunt_path) {
      setSamePaths(false);
      setTerragruntForm((prev) => ({ ...prev, path: data.terragrunt_path ?? "." }));
    } else {
      setSamePaths(true);
    }
    setLabels((data.labels ?? []).join(", "));
    setStep(4);
  }, [data, isManageMode]);

  const selectedVcs = VCS_OPTIONS.find((o) => o.id === vcsProvider) ?? VCS_OPTIONS[0];

  const payload = useMemo(() => {
    const terraform_repo = {
      vcs_provider: vcsProvider,
      owner: terraformForm.owner.trim(),
      repo: terraformForm.repo.trim(),
      repo_ref: terraformForm.repoRef.trim() || undefined,
      path: terraformForm.path.trim() || ".",
      access_token: terraformForm.accessToken.trim() || undefined,
      base_url: terraformForm.baseUrl.trim() || undefined,
      auth_method: terraformForm.authMethod || undefined,
      installation_id: terraformForm.installationId || undefined,
      installation_account: terraformForm.installationAccount || undefined,
      repository_id: terraformForm.repositoryId || undefined,
    };
    const body: Record<string, unknown> = {
      vcs_provider: vcsProvider,
      uses_terragrunt: usesTerragrunt,
      repo_mode: usesTerragrunt ? repoMode : "single",
      terraform_repo,
      labels: labels.split(",").map((s) => s.trim()).filter(Boolean),
    };
    if (usesTerragrunt && repoMode === "dual") {
      body.terragrunt_repo = {
        vcs_provider: vcsProvider,
        owner: terragruntForm.owner.trim(),
        repo: terragruntForm.repo.trim(),
        repo_ref: terragruntForm.repoRef.trim() || undefined,
        path: terragruntForm.path.trim() || ".",
        access_token: terragruntForm.accessToken.trim() || undefined,
        base_url: terragruntForm.baseUrl.trim() || undefined,
        auth_method: terragruntForm.authMethod || undefined,
        installation_id: terragruntForm.installationId || undefined,
        installation_account: terragruntForm.installationAccount || undefined,
        repository_id: terragruntForm.repositoryId || undefined,
      };
    } else if (usesTerragrunt && !samePaths) {
      body.terragrunt_path = terragruntForm.path.trim() || terraformForm.path.trim() || ".";
    }
    return body;
  }, [vcsProvider, usesTerragrunt, repoMode, terraformForm, terragruntForm, samePaths, labels]);

  const save = useMutation({
    mutationFn: () =>
      api("/v1/integrations/iac-repository", {
        method: "PUT",
        schema: iacRepositoryIntegrationSchema,
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iac-repository-integration"] });
      qc.invalidateQueries({ queryKey: ["github-issues-integration"] });
      setSaveError("");
      setShowVerified(true);
    },
    onError: (e) => setSaveError(formatApiError(e)),
  });

  const disconnect = useMutation({
    mutationFn: () => api<void>("/v1/integrations/iac-repository", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["iac-repository-integration"] });
      qc.invalidateQueries({ queryKey: ["github-issues-integration"] });
      setStep(1);
      setTerraformForm(emptyRepoForm());
      setTerragruntForm(emptyRepoForm());
    },
  });

  const maxStep: WizardStep = 4;
  const githubRepoSelected = !!terraformForm.repoRef;
  const githubAppRepoSelected = !!terraformForm.repositoryId;
  const githubTerragruntReady =
    !usesTerragrunt || repoMode !== "dual" || (usesGithubOAuth ? !!terragruntForm.repoRef : !!terragruntForm.repositoryId);
  const githubRepoReady =
    vcsProvider !== "github" ||
    (githubRepoSelected &&
      (usesGithubOAuth || (usesGithubAppFallback && githubAppRepoSelected)) &&
      githubTerragruntReady);
  const canAdvance =
    step === 1 ||
    step === 2 ||
    (step === 3 && (!usesTerragrunt || repoMode)) ||
    (step === 4 && githubRepoReady);

  if (!isLoading && data?.connected && !isManageMode && !showVerified) {
    return <Navigate to="/integrations" replace />;
  }

  return (
    <div className="integration-setup integration-setup--iac">
      <header className="integration-setup__header integration-setup__hero">
        <div className="integration-setup__hero-mark">
          <IntegrationBrandIcon brand="iac" size={64} />
        </div>
        <h1 className="integration-setup__title">Link Terraform / Terragrunt repository</h1>
        <p className="integration-setup__subtitle">
          Connect the repository where cloud fixes land as infrastructure-as-code pull requests. Veritrail uses this
          layout for snippets, path guidance, and remediation tickets.
        </p>
        <div className="integration-setup__flow" aria-label="Remediation workflow">
          {FLOW_NODES.map((node) => (
            <div className="integration-setup__flow-node" key={node.title}>
              <span className="integration-setup__flow-title">{node.title}</span>
              <span className="integration-setup__flow-detail">{node.detail}</span>
            </div>
          ))}
        </div>
      </header>

      {isLoading && <p className="integration-setup__loading">Loading…</p>}
      {!isLoading && showVerified && (
        <div className="integration-setup__card">
          <VerifiedSuccessCard />
        </div>
      )}
      {!isLoading && !showVerified && (
        <div className="integration-setup__card">
          <ol className="integration-setup__steps">
            {STEP_LABELS.map((label, i) => {
              const n = (i + 1) as WizardStep;
              const active = step === n;
              const done = step > n;
              return (
                <li
                  key={label}
                  className={`integration-setup__step ${active ? "integration-setup__step--active" : ""} ${
                    done ? "integration-setup__step--done" : ""
                  }`}
                >
                  {i + 1}. {label}
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <section className="integration-setup__step-panel">
              <h2 className="integration-setup__panel-title">Pick your version control provider</h2>
              <p className="integration-setup__panel-copy">
                GitHub reuses your source-control connection (owner + repository picker). GitLab can reuse OAuth,
                while Azure DevOps and CodeCommit use repository references plus optional tokens.
              </p>
              <div className="integration-setup__provider-grid">
                {VCS_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setVcsProvider(option.id)}
                    aria-pressed={vcsProvider === option.id}
                    className={`integration-setup__provider-card ${
                      vcsProvider === option.id ? "integration-setup__provider-card--selected" : ""
                    }`}
                  >
                    <IntegrationBrandIcon brand={option.brand} size={44} />
                    <span className="integration-setup__provider-copy">
                      <span className="integration-setup__provider-name">{option.label}</span>
                      <span className="integration-setup__provider-hint">{option.authHint}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="integration-setup__step-panel">
              <h2 className="integration-setup__panel-title">Do you use Terragrunt with Terraform?</h2>
              <p className="integration-setup__panel-copy">
                Terragrunt wraps Terraform modules into per-environment live stacks. If yes, we&apos;ll ask how your
                repos are organized next.
              </p>
              <div className="integration-setup__choice-row">
                {[
                  { value: false, label: "No, Terraform only" },
                  { value: true, label: "Yes, Terragrunt live stacks" },
                ].map((opt) => (
                  <button
                    key={String(opt.value)}
                    type="button"
                    onClick={() => setUsesTerragrunt(opt.value)}
                    aria-pressed={usesTerragrunt === opt.value}
                    className={`integration-setup__choice-btn ${
                      usesTerragrunt === opt.value ? "integration-setup__choice-btn--selected" : ""
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="integration-setup__step-panel">
              <h2 className="integration-setup__panel-title">
                {usesTerragrunt ? "One repository or two?" : "Repository layout"}
              </h2>
              {usesTerragrunt ? (
                <>
                  <p className="integration-setup__panel-copy">
                    <strong>One repo</strong> keeps modules and live stacks in different folders.{" "}
                    <strong>Two repos</strong> separates modules from live-stack repositories.
                  </p>
                  <div className="integration-setup__choice-row">
                    {[
                      { value: "single" as RepoMode, label: "One repo, different paths" },
                      { value: "dual" as RepoMode, label: "Two separate repos" },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setRepoMode(opt.value)}
                        aria-pressed={repoMode === opt.value}
                        className={`integration-setup__choice-btn ${
                          repoMode === opt.value ? "integration-setup__choice-btn--selected" : ""
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p className="integration-setup__panel-copy">
                  Terraform-only teams link a single repository. You can set an optional subdirectory path on the next
                  step.
                </p>
              )}
            </section>
          )}

          {step === 4 && (
            <section className="integration-setup__step-panel integration-setup__step-panel--stacked">
              <h2 className="integration-setup__panel-title">Link your repositories</h2>
              <p className="integration-setup__panel-copy">{selectedVcs.authHint}</p>

              {vcsProvider === "github" ? (
                usesGithubOAuth ? (
                  <GitHubOAuthRepositoryPicker
                    title={usesTerragrunt ? "Terraform modules repository" : "IaC repository"}
                    form={terraformForm}
                    onChange={setTerraformForm}
                    oauthLogin={githubProvider.data?.login ?? data?.github_oauth_login}
                    initialOrgLogins={githubOAuthOrgLogins}
                    filter={githubRepoFilter}
                    onFilterChange={setGithubRepoFilter}
                    pathLabel="Terraform path"
                    pathPlaceholder="e.g. modules or ."
                  />
                ) : (
                  <>
                    <GitHubConnectCard
                      isAppConfigured={!!data?.github_app_configured}
                      connectPending={connectGithub.isPending}
                      connectError={githubConnectError}
                      onConnect={() => connectGithub.mutate()}
                    />
                    {usesGithubAppFallback ? (
                      <GitHubAppRepositoryPicker
                        title={usesTerragrunt ? "Terraform modules repository" : "IaC repository"}
                        form={terraformForm}
                        onChange={setTerraformForm}
                        repos={githubAppRepos.data ?? []}
                        isLoading={githubAppRepos.isLoading}
                        isInstalled={!!data?.github_app_installed}
                        isConfigured={!!data?.github_app_configured}
                        account={data?.github_app_account}
                        installationId={data?.github_app_installation_id}
                        manageUrl={data?.github_app_manage_url}
                        installPending={installGithubApp.isPending}
                        installError={githubInstallError}
                        onInstall={() => installGithubApp.mutate()}
                        filter={githubRepoFilter}
                        onFilterChange={setGithubRepoFilter}
                        pathLabel="Terraform path"
                        pathPlaceholder="e.g. modules or ."
                      />
                    ) : null}
                  </>
                )
              ) : (
                <>
                  <div className="integration-setup__callout integration-setup__callout--neutral">
                    {repoLinkCallout(vcsProvider, selectedVcs.label)}
                  </div>

                  <div>
                    <h3 className="text-[13px] font-semibold text-zinc-800">
                      {usesTerragrunt ? "Terraform modules repository" : "IaC repository"}
                    </h3>
                    <RepoFields
                      vcs={vcsProvider}
                      form={terraformForm}
                      onChange={setTerraformForm}
                      pathLabel="Terraform path"
                      pathPlaceholder="e.g. modules or ."
                    />
                  </div>
                </>
              )}

              {usesTerragrunt && repoMode === "single" && (
                <div>
                  <h3 className="text-[13px] font-semibold text-zinc-800">Terragrunt live stacks (same repo)</h3>
                  <label className="mt-1 flex items-center gap-2 text-[12px] text-zinc-600">
                    <input type="checkbox" checked={samePaths} onChange={(e) => setSamePaths(e.target.checked)} />
                    Same path as Terraform
                  </label>
                  {!samePaths && (
                    vcsProvider === "github" ? (
                      <div className="integration-setup__field--wide">
                        <label className="integration-setup__field-label">Terragrunt path</label>
                        <input
                          className="integration-setup__input"
                          value={terragruntForm.path}
                          onChange={(e) => setTerragruntForm({ ...terragruntForm, path: e.target.value })}
                          placeholder="e.g. environments/prod/us-east-1"
                        />
                      </div>
                    ) : (
                      <RepoFields
                        vcs={vcsProvider}
                        form={{ ...terragruntForm, owner: terraformForm.owner, repo: terraformForm.repo, repoRef: terraformForm.repoRef }}
                        onChange={(next) => setTerragruntForm({ ...next, owner: terraformForm.owner, repo: terraformForm.repo, repoRef: terraformForm.repoRef })}
                        pathLabel="Terragrunt path"
                        pathPlaceholder="e.g. environments/prod/us-east-1"
                      />
                    )
                  )}
                </div>
              )}

              {usesTerragrunt && repoMode === "dual" && (
                <div>
                  {vcsProvider === "github" ? (
                    usesGithubOAuth ? (
                      <GitHubOAuthRepositoryPicker
                        title="Terragrunt live stacks repository"
                        form={terragruntForm}
                        onChange={setTerragruntForm}
                        oauthLogin={githubProvider.data?.login ?? data?.github_oauth_login}
                        initialOrgLogins={githubOAuthOrgLogins}
                        filter={githubTerragruntRepoFilter}
                        onFilterChange={setGithubTerragruntRepoFilter}
                        pathLabel="Live stack path"
                        pathPlaceholder="e.g. . or prod/us-east-1"
                      />
                    ) : usesGithubAppFallback ? (
                      <GitHubAppRepositoryPicker
                        title="Terragrunt live stacks repository"
                        form={terragruntForm}
                        onChange={setTerragruntForm}
                        repos={githubAppRepos.data ?? []}
                        isLoading={githubAppRepos.isLoading}
                        isInstalled={!!data?.github_app_installed}
                        isConfigured={!!data?.github_app_configured}
                        account={data?.github_app_account}
                        installationId={data?.github_app_installation_id}
                        manageUrl={data?.github_app_manage_url}
                        installPending={installGithubApp.isPending}
                        installError={githubInstallError}
                        onInstall={() => installGithubApp.mutate()}
                        filter={githubTerragruntRepoFilter}
                        onFilterChange={setGithubTerragruntRepoFilter}
                        pathLabel="Live stack path"
                        pathPlaceholder="e.g. . or prod/us-east-1"
                      />
                    ) : null
                  ) : (
                    <>
                      <h3 className="text-[13px] font-semibold text-zinc-800">Terragrunt live stacks repository</h3>
                      <RepoFields
                        vcs={vcsProvider}
                        form={terragruntForm}
                        onChange={setTerragruntForm}
                        pathLabel="Live stack path"
                        pathPlaceholder="e.g. . or prod/us-east-1"
                      />
                    </>
                  )}
                </div>
              )}

              {vcsProvider === "github" && (
                <div className="integration-setup__field--wide">
                  <label className="integration-setup__field-label">Ticket labels (comma-separated)</label>
                  <input className="integration-setup__input" value={labels} onChange={(e) => setLabels(e.target.value)} />
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Applied when creating remediation tickets from findings (GitHub provider).
                  </p>
                </div>
              )}
            </section>
          )}

          {saveError && <p className="integration-setup__error">{saveError}</p>}

          <div className="integration-setup__actions mt-6">
            {step > 1 && (
              <button
                type="button"
                className="integration-setup__btn"
                onClick={() => setStep((s) => Math.max(1, s - 1) as WizardStep)}
              >
                Back
              </button>
            )}
            {step < maxStep ? (
              <button
                type="button"
                className="integration-setup__btn integration-setup__btn--primary"
                disabled={!canAdvance}
                onClick={() => {
                  if (step === 2 && !usesTerragrunt) {
                    setStep(4);
                    return;
                  }
                  setStep((s) => Math.min(maxStep, s + 1) as WizardStep);
                }}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="integration-setup__btn integration-setup__btn--primary"
                disabled={save.isPending || !githubRepoReady}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : data?.connected ? "Update connection" : "Save connection"}
              </button>
            )}
            {data?.connected && step === 4 && (
              <button
                type="button"
                className="integration-setup__btn integration-setup__btn--danger"
                disabled={disconnect.isPending}
                onClick={() => disconnect.mutate()}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
