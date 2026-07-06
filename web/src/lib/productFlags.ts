/** Extended integrations (scanners, SIEM, IaC repo, Azure DevOps). */
export const SHOW_EXTENDED_INTEGRATIONS =
  import.meta.env.VITE_SHOW_EXTENDED_INTEGRATIONS === "true";

/** SSM auto-fix, Terraform PR bot, connector remediation module toggles. */
export const SHOW_WRITE_REMEDIATION =
  import.meta.env.VITE_SHOW_WRITE_REMEDIATION === "true";
