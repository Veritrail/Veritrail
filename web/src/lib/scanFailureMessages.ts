/**
 * End-user copy for failed account scans. Raw API/worker errors stay in logs only.
 */

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

export function friendlyScanFailureMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes("permission denied") ||
    lower.includes("403") ||
    (lower.includes("googleapis") && lower.includes("denied"))
  ) {
    return (
      "Veritrail could not read your GCP project because the scanner service account is missing permissions. " +
      "Re-run the gcloud setup on the GCP integration page, then verify and scan again."
    );
  }

  if (
    lower.includes("azure") ||
    lower.includes("microsoft") ||
    lower.includes("graph.microsoft") ||
    lower.includes("arm.microsoft")
  ) {
    if (lower.includes("unauthorized") || lower.includes("invalid_client") || lower.includes("aadsts")) {
      return (
        "Veritrail could not authenticate to Azure with the registered app credentials. " +
        "Confirm the client secret on the Azure integration page, then verify again."
      );
    }
    if (lower.includes("access denied") || lower.includes("authorizationfailed")) {
      return (
        "Veritrail could not read your Azure subscription because the app is missing Reader or Security Reader. " +
        "Update role assignments, then verify and scan again."
      );
    }
  }

  if (
    lower.includes("gcp") ||
    lower.includes("googleapis") ||
    lower.includes("workload identity") ||
    (lower.includes("service account") && !lower.includes("aws"))
  ) {
    if (lower.includes("impersonat") || lower.includes("tokencreator")) {
      return (
        "Veritrail could not impersonate your GCP scanner service account. " +
        "Confirm TokenCreator is granted to the Veritrail connection account, then verify again."
      );
    }
  }

  if (
    lower.includes("tokenretrieval") ||
    lower.includes("retrieving token from sso") ||
    lower.includes("sso") && (lower.includes("profile") || lower.includes("token") || lower.includes("session"))
  ) {
    return (
      "Veritrail could not reach AWS using the credentials configured for this scan. " +
      "If you use AWS SSO on your computer, sign in with the AWS CLI (`aws sso login`) for the profile tied to this account, " +
      "or reconnect the account from Accounts with a role Veritrail can assume."
    );
  }

  if (
    lower.includes("expiredtoken") ||
    lower.includes("token has expired") ||
    lower.includes("credentials") && lower.includes("expired")
  ) {
    return "The AWS session used for scanning has expired. Reconnect your account on Accounts, then run a new scan.";
  }

  if (
    lower.includes("accessdenied") ||
    lower.includes("not authorized") ||
    lower.includes("unauthorized") ||
    lower.includes("is not authorized to perform")
  ) {
    return (
      "Veritrail could not read your AWS account because the connector role is missing permissions or trust. " +
      "Open Accounts, verify the connector, and update CloudFormation if prompted."
    );
  }

  if (lower.includes("assumerole") || lower.includes("externalid") || lower.includes("trust")) {
    return (
      "Veritrail could not assume the read-only role in your AWS account. " +
      "Check that the CloudFormation stack is still deployed and that the role ARN on Accounts matches your account."
    );
  }

  if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("too many requests")) {
    return "AWS temporarily limited how fast Veritrail could scan. Wait a few minutes and run a scan from Findings.";
  }

  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "The scan took too long and stopped. Try again in a few minutes; if it keeps failing, check connector health on Accounts.";
  }

  if (lower.includes("no credentials") || lower.includes("unable to locate credentials")) {
    return (
      "No valid AWS credentials were available for this scan. " +
      "Reconnect the account on Accounts or confirm your deployment has access to assume the customer role."
    );
  }

  if (
    lower.includes("connection") ||
    lower.includes("network") ||
    lower.includes("could not connect") ||
    lower.includes("name or service not known")
  ) {
    return "Veritrail could not reach AWS. Check that your network is up and try running a scan again.";
  }

  if (lower.includes("region") && lower.includes("invalid")) {
    return "The scan ran in a region Veritrail does not support for this account. Check the account region on Accounts and try again.";
  }

  // Long stack traces / Python tracebacks — never show verbatim.
  if (isTechnicalScanError(raw)) {
    return (
      "Something went wrong while Veritrail was collecting evidence. " +
      "Verify your cloud connection, then run a scan again. " +
      "If this keeps happening, contact your Veritrail administrator."
    );
  }

  if (lower.includes("error") || lower.includes("exception") || lower.includes("failed")) {
    return (
      "The scan did not finish successfully. " +
      "Verify your AWS connection on Accounts, then run a scan from Findings."
    );
  }

  return (
    "The scan did not finish successfully. " +
    "Verify your AWS connection on Accounts, then run a scan from Findings."
  );
}

export const SCAN_FAILURE_USER_ACTION =
  "Open Accounts to verify your connector, then run a scan from Findings.";

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
