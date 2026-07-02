/**
 * End-user copy for failed account scans. Raw API/worker errors stay in logs only.
 */

export type ScanFailureDisplayContext = {
  provider?: string | null;
  accountLabel?: string | null;
};

type ScanProvider = "aws" | "gcp" | "azure";

export function scanFailureAccountLabel(opts: {
  label?: string | null;
  externalId?: string | null;
}): string | undefined {
  if (opts.label?.trim()) return opts.label.trim();
  const id = opts.externalId?.trim();
  if (!id) return undefined;
  return /^\d{12}$/.test(id) ? id.replace(/(\d{4})(?=\d)/g, "$1 ") : id;
}

export function providerShortLabel(provider?: string | null): string | undefined {
  if (!provider) return undefined;
  switch (provider.toLowerCase()) {
    case "gcp":
      return "GCP";
    case "azure":
      return "Azure";
    case "aws":
      return "AWS";
    default:
      return provider.toUpperCase();
  }
}

function resolveScanFailureProvider(raw: string, explicit?: string | null): ScanProvider {
  const normalized = explicit?.trim().toLowerCase();
  if (normalized === "gcp" || normalized === "azure" || normalized === "aws") {
    return normalized;
  }
  const lower = raw.toLowerCase();
  if (
    lower.includes("googleapis") ||
    lower.includes("gcp_osconfig") ||
    lower.includes("workload identity") ||
    (lower.includes("service account") && !lower.includes("aws"))
  ) {
    return "gcp";
  }
  if (
    lower.includes("azure") ||
    lower.includes("microsoft") ||
    lower.includes("graph.microsoft") ||
    lower.includes("arm.microsoft") ||
    lower.includes("aadsts")
  ) {
    return "azure";
  }
  return "aws";
}

function scanFailureAccountPhrase(accountLabel?: string | null): string {
  const name = accountLabel?.trim();
  return name ? ` for ${name}` : "";
}

function genericScanFailureMessage(provider: ScanProvider, accountLabel?: string | null): string {
  const conn = providerShortLabel(provider) ?? "cloud";
  return (
    `The scan${scanFailureAccountPhrase(accountLabel)} did not finish successfully. ` +
    `Verify your ${conn} connection on Accounts, then run a scan from Findings.`
  );
}

function technicalScanFailureMessage(provider: ScanProvider, accountLabel?: string | null): string {
  const conn = providerShortLabel(provider) ?? "cloud";
  return (
    `Something went wrong while Veritrail was collecting evidence${scanFailureAccountPhrase(accountLabel)}. ` +
    `Verify your ${conn} connection, then run a scan again. ` +
    `If this keeps happening, contact your Veritrail administrator.`
  );
}

/** Notification bell title — includes account name and provider when known. */
export function scanFailureNotificationTitle(
  accountLabel?: string | null,
  provider?: string | null,
): string {
  const name = accountLabel?.trim();
  if (!name) return "Scan could not complete";
  const tag = providerShortLabel(provider);
  const providerSuffix = tag ? ` (${tag})` : "";
  return `Scan could not complete — ${name}${providerSuffix}`;
}

function isTechnicalScanError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return (
    raw.length > 280 ||
    lower.includes("traceback") ||
    lower.includes("sqlalchemy") ||
    lower.includes("programmingerror") ||
    lower.includes("psycopg") ||
    lower.includes("undefinedtable") ||
    lower.includes("does not exist") ||
    lower.includes("error during bootstrap") ||
    lower.includes("botocore") ||
    lower.includes("clienterror")
  );
}

/** One-line summary for integration cards — never a full traceback. */
export function summarizeIntegrationScanError(raw: string): string | null {
  const lower = raw.toLowerCase();

  if (lower.includes("gcp_osconfig") || lower.includes("osconfig_vuln")) {
    return "OS Config vulnerability collector failed.";
  }
  if (lower.includes("permission denied") || lower.includes("403") || lower.includes("access denied")) {
    return "Scanner credentials are missing permissions.";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "Scan timed out.";
  }
  if (isTechnicalScanError(raw)) {
    return null;
  }
  const firstLine = raw.split(/\r?\n/)[0]?.trim() ?? "";
  if (!firstLine) return null;
  return firstLine.length > 120 ? `${firstLine.slice(0, 117)}…` : firstLine;
}

export function friendlyScanFailureMessage(
  raw: string,
  ctx?: ScanFailureDisplayContext,
): string {
  const lower = raw.toLowerCase();
  const provider = resolveScanFailureProvider(raw, ctx?.provider);
  const accountLabel = ctx?.accountLabel;
  const accountPhrase = scanFailureAccountPhrase(accountLabel);
  const conn = providerShortLabel(provider) ?? "cloud";

  if (
    provider === "gcp" &&
    (lower.includes("permission denied") ||
      lower.includes("403") ||
      (lower.includes("googleapis") && lower.includes("denied")))
  ) {
    return (
      `Veritrail could not read your GCP project${accountPhrase} because the scanner service account is missing permissions. ` +
      "Re-run the gcloud setup on the GCP integration page, then verify and scan again."
    );
  }

  if (provider === "azure") {
    if (lower.includes("unauthorized") || lower.includes("invalid_client") || lower.includes("aadsts")) {
      return (
        `Veritrail could not authenticate to Azure${accountPhrase} with the registered app credentials. ` +
        "Confirm the client secret on the Azure integration page, then verify again."
      );
    }
    if (lower.includes("access denied") || lower.includes("authorizationfailed")) {
      return (
        `Veritrail could not read your Azure subscription${accountPhrase} because the app is missing Reader or Security Reader. ` +
        "Update role assignments, then verify and scan again."
      );
    }
  }

  if (
    provider === "gcp" &&
    (lower.includes("impersonat") || lower.includes("tokencreator"))
  ) {
    return (
      `Veritrail could not impersonate your GCP scanner service account${accountPhrase}. ` +
      "Confirm TokenCreator is granted to the Veritrail connection account, then verify again."
    );
  }

  if (provider === "aws") {
    if (
      lower.includes("tokenretrieval") ||
      lower.includes("retrieving token from sso") ||
      (lower.includes("sso") && (lower.includes("profile") || lower.includes("token") || lower.includes("session")))
    ) {
      return (
        `Veritrail could not reach AWS${accountPhrase} using the credentials configured for this scan. ` +
        "If you use AWS SSO on your computer, sign in with the AWS CLI (`aws sso login`) for the profile tied to this account, " +
        "or reconnect the account from Accounts with a role Veritrail can assume."
      );
    }

    if (
      lower.includes("expiredtoken") ||
      lower.includes("token has expired") ||
      (lower.includes("credentials") && lower.includes("expired"))
    ) {
      return `The AWS session used for scanning${accountPhrase} has expired. Reconnect your account on Accounts, then run a new scan.`;
    }

    if (
      lower.includes("accessdenied") ||
      lower.includes("not authorized") ||
      lower.includes("unauthorized") ||
      lower.includes("is not authorized to perform")
    ) {
      return (
        `Veritrail could not read your AWS account${accountPhrase} because the connector role is missing permissions or trust. ` +
        "Open Accounts, verify the connector, and update CloudFormation if prompted."
      );
    }

    if (lower.includes("assumerole") || lower.includes("externalid") || lower.includes("trust")) {
      return (
        `Veritrail could not assume the read-only role in your AWS account${accountPhrase}. ` +
        "Check that the CloudFormation stack is still deployed and that the role ARN on Accounts matches your account."
      );
    }

    if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("too many requests")) {
      return `AWS temporarily limited how fast Veritrail could scan${accountPhrase}. Wait a few minutes and run a scan from Findings.`;
    }

    if (lower.includes("no credentials") || lower.includes("unable to locate credentials")) {
      return (
        `No valid AWS credentials were available for this scan${accountPhrase}. ` +
        "Reconnect the account on Accounts or confirm your deployment has access to assume the customer role."
      );
    }

    if (
      lower.includes("connection") ||
      lower.includes("network") ||
      lower.includes("could not connect") ||
      lower.includes("name or service not known")
    ) {
      return `Veritrail could not reach AWS${accountPhrase}. Check that your network is up and try running a scan again.`;
    }

    if (lower.includes("region") && lower.includes("invalid")) {
      return `The scan${accountPhrase} ran in a region Veritrail does not support for this account. Check the account region on Accounts and try again.`;
    }
  }

  if (provider === "gcp") {
    if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("quota")) {
      return `GCP temporarily limited how fast Veritrail could scan${accountPhrase}. Wait a few minutes and run a scan from Findings.`;
    }
    if (
      lower.includes("connection") ||
      lower.includes("network") ||
      lower.includes("could not connect") ||
      lower.includes("name or service not known")
    ) {
      return `Veritrail could not reach Google Cloud${accountPhrase}. Check that your network is up and try running a scan again.`;
    }
  }

  if (provider === "azure") {
    if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("too many requests")) {
      return `Azure temporarily limited how fast Veritrail could scan${accountPhrase}. Wait a few minutes and run a scan from Findings.`;
    }
    if (
      lower.includes("connection") ||
      lower.includes("network") ||
      lower.includes("could not connect") ||
      lower.includes("name or service not known")
    ) {
      return `Veritrail could not reach Azure${accountPhrase}. Check that your network is up and try running a scan again.`;
    }
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return `The scan${accountPhrase} took too long and stopped. Try again in a few minutes; if it keeps failing, check your ${conn} connector on Accounts.`;
  }

  // Long stack traces / Python tracebacks — never show verbatim.
  if (isTechnicalScanError(raw)) {
    return technicalScanFailureMessage(provider, accountLabel);
  }

  if (lower.includes("error") || lower.includes("exception") || lower.includes("failed")) {
    return genericScanFailureMessage(provider, accountLabel);
  }

  return genericScanFailureMessage(provider, accountLabel);
}

export function scanFailureUserAction(provider?: string | null): string {
  const label = providerShortLabel(provider) ?? "cloud";
  return `Open Accounts to verify your ${label} connector, then run a scan from Findings.`;
}

/** @deprecated Use scanFailureUserAction(provider) for cloud-aware copy. */
export const SCAN_FAILURE_USER_ACTION = scanFailureUserAction();

export type ScanFailureInfo = { title: string; fix: string };

/**
 * Same classification as friendlyScanFailureMessage, but returns a short
 * reason title + one-line fix for the credential alert (instead of a paragraph).
 */
export function classifyScanFailure(raw: string): ScanFailureInfo {
  const lower = raw.toLowerCase();

  if (
    lower.includes("tokenretrieval") ||
    lower.includes("retrieving token from sso") ||
    (lower.includes("sso") && (lower.includes("profile") || lower.includes("token") || lower.includes("session")))
  ) {
    return { title: "AWS session expired", fix: "Run aws sso login for the tied profile, or reconnect the account, then re-check." };
  }
  if (
    lower.includes("expiredtoken") ||
    lower.includes("token has expired") ||
    (lower.includes("credentials") && lower.includes("expired"))
  ) {
    return { title: "AWS session expired", fix: "Reconnect the account, then run a new scan." };
  }
  if (
    lower.includes("accessdenied") ||
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("is not authorized to perform")
  ) {
    return { title: "Connector role is missing permissions", fix: "Verify the connector and re-deploy the CloudFormation stack if prompted." };
  }
  if (lower.includes("assumerole") || lower.includes("externalid") || lower.includes("trust")) {
    return { title: "Couldn't assume the connector role", fix: "Check the CloudFormation stack is deployed and the role ARN matches this account." };
  }
  if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("too many requests")) {
    return { title: "AWS rate-limited the scan", fix: "Wait a few minutes, then run a scan again." };
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return { title: "Scan timed out", fix: "Try again shortly; if it persists, check connector health." };
  }
  if (lower.includes("no credentials") || lower.includes("unable to locate credentials")) {
    return { title: "No AWS credentials available", fix: "Reconnect the account, or confirm the deployment can assume the customer role." };
  }
  if (
    lower.includes("connection") ||
    lower.includes("network") ||
    lower.includes("could not connect") ||
    lower.includes("name or service not known")
  ) {
    return { title: "Couldn't reach AWS", fix: "Check your network is up, then run a scan again." };
  }
  if (lower.includes("region") && lower.includes("invalid")) {
    return { title: "Unsupported region", fix: "Check the account region on Accounts, then try again." };
  }
  return { title: "Scan didn't finish", fix: "Verify your AWS connection, then run a scan again." };
}
