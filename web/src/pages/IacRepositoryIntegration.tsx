import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "../api";
import { iacRepositoryIntegrationSchema } from "../lib/apiSchemas";
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
  { id: "github", label: "GitHub", brand: "github", authHint: "Reuses GitHub OAuth when no token is set." },
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

type RepoForm = {
  owner: string;
  repo: string;
  repoRef: string;
  path: string;
  accessToken: string;
  baseUrl: string;
};

function emptyRepoForm(): RepoForm {
  return { owner: "", repo: "", repoRef: "", path: ".", accessToken: "", baseUrl: "" };
}

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

function RepoFields({
  vcs,
  form,
  onChange,
  pathLabel,
  pathPlaceholder,
}: {
  vcs: VcsProvider;
  form: RepoForm;
  onChange: (next: RepoForm) => void;
  pathLabel: string;
  pathPlaceholder: string;
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
              placeholder="e.g. infrastructure-live"
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
  const canAdvance =
    step === 1 ||
    step === 2 ||
    (step === 3 && (!usesTerragrunt || repoMode)) ||
    step === 4;

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
                GitHub and GitLab can reuse existing OAuth connections. Azure DevOps and CodeCommit use repository
                references plus optional tokens.
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

              {usesTerragrunt && repoMode === "single" && (
                <div>
                  <h3 className="text-[13px] font-semibold text-zinc-800">Terragrunt live stacks (same repo)</h3>
                  <label className="mt-1 flex items-center gap-2 text-[12px] text-zinc-600">
                    <input type="checkbox" checked={samePaths} onChange={(e) => setSamePaths(e.target.checked)} />
                    Same path as Terraform
                  </label>
                  {!samePaths && (
                    <RepoFields
                      vcs={vcsProvider}
                      form={{ ...terragruntForm, owner: terraformForm.owner, repo: terraformForm.repo, repoRef: terraformForm.repoRef }}
                      onChange={(next) => setTerragruntForm({ ...next, owner: terraformForm.owner, repo: terraformForm.repo, repoRef: terraformForm.repoRef })}
                      pathLabel="Terragrunt path"
                      pathPlaceholder="e.g. environments/prod/us-east-1"
                    />
                  )}
                </div>
              )}

              {usesTerragrunt && repoMode === "dual" && (
                <div>
                  <h3 className="text-[13px] font-semibold text-zinc-800">Terragrunt live stacks repository</h3>
                  <RepoFields
                    vcs={vcsProvider}
                    form={terragruntForm}
                    onChange={setTerragruntForm}
                    pathLabel="Live stack path"
                    pathPlaceholder="e.g. . or prod/us-east-1"
                  />
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
                disabled={save.isPending}
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
