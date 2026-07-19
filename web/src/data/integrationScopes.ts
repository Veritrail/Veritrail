/** Exact OAuth scopes / cloud roles Veritrail requests per integration.
 *  Source of truth: backend integration routes + setup docs. Keep minimal.
 */

export type IntegrationScopeRow = {
  integration: string;
  auth: string;
  scopesOrRoles: string;
  purpose: string;
};

export const INTEGRATION_SCOPES: IntegrationScopeRow[] = [
  {
    integration: "AWS",
    auth: "IAM role assume (ExternalId)",
    scopesOrRoles:
      "Read-only scanner role from Accounts → Connect AWS (CORE_SCANNER_STATEMENTS / CFN). See Accounts permission review for the full action list.",
    purpose: "Collect inventory + run posture checks; optional nested stacks for remediation / advanced IAM.",
  },
  {
    integration: "GCP",
    auth: "Service account impersonation",
    scopesOrRoles:
      "roles/viewer, roles/logging.viewer, roles/osconfig.viewer, roles/securitycenter.findingsViewer, roles/cloudasset.viewer; platform SA needs roles/iam.serviceAccountTokenCreator on the scanner SA",
    purpose: "Read-only project inventory, logging, SCC, and asset IAM checks.",
  },
  {
    integration: "Azure",
    auth: "Entra app client credentials",
    scopesOrRoles: "Subscription RBAC: Reader + Security Reader",
    purpose: "Defender, storage, Resource Graph, Activity Log, privileged RBAC, Policy compliance.",
  },
  {
    integration: "GitHub",
    auth: "OAuth App",
    scopesOrRoles: "read:user user:email read:org repo",
    purpose: "Org/repo security posture (MFA, branch protection, collaborators) and optional Issues ticketing.",
  },
  {
    integration: "GitLab",
    auth: "OAuth App",
    scopesOrRoles: "read_api",
    purpose: "Group/project security posture (MFA, protected branches, MR reviews).",
  },
  {
    integration: "Microsoft Entra ID",
    auth: "OAuth 2.0 (delegated)",
    scopesOrRoles: "offline_access User.Read Directory.Read.All RoleManagement.Read.Directory",
    purpose: "Directory users, MFA enforcement, privileged role assignments.",
  },
  {
    integration: "Google Workspace",
    auth: "OAuth 2.0 (admin)",
    scopesOrRoles:
      "openid email profile https://www.googleapis.com/auth/admin.directory.user.readonly https://www.googleapis.com/auth/admin.directory.rolemanagement.readonly",
    purpose: "Workspace users, 2SV enforcement, admin role review.",
  },
];
