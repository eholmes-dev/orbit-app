import { createHash, randomBytes } from "node:crypto";

const TENANT = process.env.MS_TENANT_ID;
const CLIENT_ID = process.env.MS_CLIENT_ID;
const CLIENT_SECRET = process.env.MS_CLIENT_SECRET;
const REDIRECT_URI = process.env.MS_REDIRECT_URI;

if (!TENANT || !CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
  throw new Error(
    "Missing Microsoft OAuth env: MS_TENANT_ID, MS_CLIENT_ID, MS_CLIENT_SECRET, MS_REDIRECT_URI all required.",
  );
}

const AUTHORITY = `https://login.microsoftonline.com/${TENANT}`;

// Delegated scopes the app needs. offline_access -> refresh tokens.
// Calendars.ReadWrite covers the signed-in user's calendar; the .Shared variant
// covers calendars explicitly shared with them. Tenant-wide access ("all
// staff calendars") requires the Application permission `Calendars.ReadWrite`
// added separately + client-credentials flow — that's a Phase 3b/3c decision.
export const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "User.Read",
  "Calendars.ReadWrite",
  "Calendars.ReadWrite.Shared",
  "MailboxSettings.Read",
];

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest()
    .toString("base64url");
  return { verifier, challenge };
}

export function newState(): string {
  return randomBytes(16).toString("hex");
}

export function authorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: "code",
    redirect_uri: REDIRECT_URI!,
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORITY}/oauth2/v2.0/authorize?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID!,
    scope: SCOPES.join(" "),
    code,
    redirect_uri: REDIRECT_URI!,
    grant_type: "authorization_code",
    code_verifier: verifier,
    client_secret: CLIENT_SECRET!,
  });
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID!,
    scope: SCOPES.join(" "),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
    client_secret: CLIENT_SECRET!,
  });
  const res = await fetch(`${AUTHORITY}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Fetch the authenticated user's profile from Microsoft Graph /me. */
export async function fetchGraphMe(accessToken: string): Promise<{
  id: string;
  displayName: string;
  mail: string | null;
  userPrincipalName: string;
}> {
  const res = await fetch("https://graph.microsoft.com/v1.0/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Graph /me failed: ${res.status}`);
  return (await res.json()) as {
    id: string;
    displayName: string;
    mail: string | null;
    userPrincipalName: string;
  };
}
