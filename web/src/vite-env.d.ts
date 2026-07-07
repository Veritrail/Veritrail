/// <reference types="vite/client" />

declare module "@fontsource-variable/geist";

interface PasswordCredentialData {
  id: string;
  password: string;
  name?: string;
}

interface PasswordCredential extends Credential {
  readonly password: string;
}

declare const PasswordCredential: {
  prototype: PasswordCredential;
  new (data: PasswordCredentialData | HTMLFormElement): PasswordCredential;
};
