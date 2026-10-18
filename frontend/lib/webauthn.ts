// The browser half of passkeys: turn the server's JSON options into what navigator.credentials wants (byte arrays),
// run the ceremony, and turn the result back into JSON (base64url) for the server to verify. Nothing here decides
// whether anything is valid; the server checks every field.

export type PasskeyCredentialJson = {
  id: string;
  rawId: string;
  type: "public-key";
  response: Record<string, string | string[] | null>;
};

const toBytes = (b64url: string): ArrayBuffer => {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const bin = atob(b64url.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const toB64u = (buf: ArrayBuffer): string => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** This browser can make and use passkeys. */
export const passkeysSupported = () => typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && Boolean(navigator.credentials);

/** The browser can offer passkeys in the username field's autofill list, without a button press. */
export async function conditionalSupported(): Promise<boolean> {
  try {
    return passkeysSupported() && typeof PublicKeyCredential.isConditionalMediationAvailable === "function" && (await PublicKeyCredential.isConditionalMediationAvailable());
  } catch {
    return false;
  }
}

type CreationOptionsJson = {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout?: number;
  attestation?: AttestationConveyancePreference;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  excludeCredentials?: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[];
};

type RequestOptionsJson = { challenge: string; rpId: string; timeout?: number; userVerification?: UserVerificationRequirement; allowCredentials?: { type: "public-key"; id: string; transports?: AuthenticatorTransport[] }[] };

/** Ask the device to make a passkey. Throws the browser's own error (NotAllowedError when the person cancels). */
export async function createPasskey(options: CreationOptionsJson): Promise<PasskeyCredentialJson> {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: toBytes(options.challenge),
      user: { ...options.user, id: toBytes(options.user.id) },
      excludeCredentials: (options.excludeCredentials ?? []).map((c) => ({ ...c, id: toBytes(c.id) })),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was created.", "NotAllowedError");
  const r = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: toB64u(credential.rawId),
    type: "public-key",
    response: { clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject), transports: typeof r.getTransports === "function" ? r.getTransports() : [] },
  };
}

/** Ask the device to prove possession of a passkey. `conditional` shows them in the username field's autofill instead. */
export async function getPasskey(options: RequestOptionsJson, opts: { conditional?: boolean; signal?: AbortSignal } = {}): Promise<PasskeyCredentialJson> {
  const credential = (await navigator.credentials.get({
    publicKey: { ...options, challenge: toBytes(options.challenge), allowCredentials: (options.allowCredentials ?? []).map((c) => ({ ...c, id: toBytes(c.id) })) },
    ...(opts.conditional ? { mediation: "conditional" as CredentialMediationRequirement } : {}),
    signal: opts.signal,
  })) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("No passkey was chosen.", "NotAllowedError");
  const r = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: toB64u(credential.rawId),
    type: "public-key",
    response: {
      clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData),
      signature: toB64u(r.signature),
      userHandle: r.userHandle ? toB64u(r.userHandle) : null,
    },
  };
}

/** What to tell the person when a ceremony fails in the browser, in plain words. */
export function passkeyErrorMessage(err: unknown): string | null {
  const name = (err as { name?: string } | null)?.name;
  if (name === "AbortError") return null; // we cancelled it ourselves
  if (name === "NotAllowedError") return "The passkey request was cancelled or timed out.";
  if (name === "InvalidStateError") return "This device already has a passkey for your account.";
  if (name === "SecurityError") return "This page can’t use passkeys: the site’s address doesn’t match its passkey settings.";
  if (name === "NotSupportedError") return "This device doesn’t support the kind of passkey Craton asked for.";
  return "Couldn’t use a passkey here. Try again, or use your password.";
}
