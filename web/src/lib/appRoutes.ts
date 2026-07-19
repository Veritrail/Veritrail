export const HOME_PATH = "/home";
export const LEGACY_ACCOUNTS_PATH = "/accounts";

export function homePath(search = ""): string {
  return `${HOME_PATH}${search}`;
}
