/** IAM role ARN: arn:aws:iam::<12-digit account>:role/<name or path/name> */
export const IAM_ROLE_ARN_RE =
  /^arn:aws:iam::\d{12}:role\/[\w+=,.@\-/]+$/;

export function isValidIamRoleArn(value: string): boolean {
  return IAM_ROLE_ARN_RE.test(sanitizeIamRoleArnInput(value));
}

/** CFN console / table paste often adds tabs, newlines, or zero-width chars. */
export function sanitizeIamRoleArnInput(value: string): string {
  return value.replace(/[\s\u200b-\u200d\ufeff]/g, "");
}

/** Extract 12-digit AWS account id from an IAM role ARN, if present. */
export function extractAccountIdFromIamRoleArn(value: string): string | null {
  const match = sanitizeIamRoleArnInput(value).match(/^arn:aws:iam::(\d{12}):role\//);
  return match?.[1] ?? null;
}
