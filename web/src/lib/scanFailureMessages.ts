/**
 * End-user copy for failed account scans. Raw API/worker errors stay in logs only.
 */

export function friendlyScanFailureMessage(raw: string): string {
  const lower = raw.toLowerCase();

  if (
    lower.includes("tokenretrieval") ||
    lower.includes("retrieving token from sso") ||
    lower.includes("sso") && (lower.includes("profile") || lower.includes("token") || lower.includes("session"))
  ) {
    return (
      "Vigil could not reach AWS using the credentials configured for this scan. " +
      "If you use AWS SSO on your computer, sign in with the AWS CLI (`aws sso login`) for the profile tied to this account, " +
      "or reconnect the account from Accounts with a role Vigil can assume."
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
      "Vigil could not read your AWS account because the connector role is missing permissions or trust. " +
      "Open Accounts, verify the connector, and update CloudFormation if prompted."
    );
  }

  if (lower.includes("assumerole") || lower.includes("externalid") || lower.includes("trust")) {
    return (
      "Vigil could not assume the read-only role in your AWS account. " +
      "Check that the CloudFormation stack is still deployed and that the role ARN on Accounts matches your account."
    );
  }

  if (lower.includes("throttl") || lower.includes("rate exceeded") || lower.includes("too many requests")) {
    return "AWS temporarily limited how fast Vigil could scan. Wait a few minutes and run a scan from Findings.";
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
    return "Vigil could not reach AWS. Check that your network is up and try running a scan again.";
  }

  if (lower.includes("region") && lower.includes("invalid")) {
    return "The scan ran in a region Vigil does not support for this account. Check the account region on Accounts and try again.";
  }

  // Long stack traces / Python tracebacks — never show verbatim.
  if (
    raw.length > 280 ||
    lower.includes("traceback") ||
    lower.includes("error during bootstrap") ||
    lower.includes("botocore") ||
    lower.includes("clienterror")
  ) {
    return (
      "Something went wrong while Vigil was collecting evidence from AWS. " +
      "Open Accounts to verify your connector, then run a scan from Findings. " +
      "If this keeps happening, contact your Vigil administrator."
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
