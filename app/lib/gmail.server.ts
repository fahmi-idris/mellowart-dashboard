/**
 * Gmail API sender via the OAuth2 authorization-code (web app) flow. A single
 * Workspace mailbox is authorized once (/google/authorize → /google/callback);
 * tokens live in D1. Access tokens last ~1h and are refreshed on demand. Google
 * refresh tokens are long-lived and usually don't rotate, so we keep the stored
 * one if a refresh response omits a new one.
 *
 * Workers can't open SMTP connections, so we POST the RFC-822 message to the
 * Gmail REST API over HTTPS.
 */

import { getGoogleTokens, saveGoogleTokens, type GoogleTokenRow } from "~/lib/google-tokens.server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

/** `gmail.send` to send; `openid email` so we can record the From address. */
export const GOOGLE_SCOPES = "openid email https://www.googleapis.com/auth/gmail.send";
const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

export function hasGmailSendScope(scopes: string | undefined): boolean {
  return scopes?.split(/\s+/).includes(GMAIL_SEND_SCOPE) ?? false;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/** Build the Google consent URL. `access_type=offline` + `prompt=consent`
 * guarantee a refresh token is returned. */
export function buildGoogleAuthorizeUrl(
  env: Env,
  params: { state: string; redirectUri: string },
): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: params.redirectUri,
    scope: GOOGLE_SCOPES,
    state: params.state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
  });
  return `${AUTH_URL}?${q.toString().replace(/\+/g, "%20")}`;
}

async function postToken(env: Env, extra: Record<string, string>) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...extra,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Google token request failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

/** Exchange an auth code for tokens (called from /google/callback). */
export function exchangeGoogleCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  return postToken(env, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  });
}

/** Email address from the id_token payload (issued by Google over TLS). */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
    const json = JSON.parse(
      new TextDecoder().decode(Uint8Array.from(atob(b64 + pad), (c) => c.charCodeAt(0))),
    ) as { email?: string };
    return json.email ?? null;
  } catch {
    return null;
  }
}

/**
 * Valid access token + From address, refreshing when within 60s of expiry and
 * persisting the result. Throws when the app has never been connected.
 */
async function getValidAccessToken(env: Env): Promise<{ token: string; email: string }> {
  const row = await getGoogleTokens(env.DB);
  if (!row) throw new Error("Gmail is not connected — authorize it first.");
  if (row.expiresAt > Date.now() + 60_000) {
    return { token: row.accessToken, email: row.email };
  }

  const refreshed = await postToken(env, {
    grant_type: "refresh_token",
    refresh_token: row.refreshToken,
  });
  const updated: GoogleTokenRow = {
    accessToken: refreshed.access_token,
    // Google usually omits refresh_token on refresh — keep the existing one.
    refreshToken: refreshed.refresh_token ?? row.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
    email: row.email,
  };
  await saveGoogleTokens(env.DB, updated);
  return { token: updated.accessToken, email: updated.email };
}

function base64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** RFC 2047 encode a header value so non-ASCII (names, subjects) survives. */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value)
    ? value
    : `=?UTF-8?B?${btoa(unescape(encodeURIComponent(value)))}?=`;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  fromName?: string;
}

/** Send one HTML email as the connected mailbox. Throws on API failure. */
export async function sendEmail(env: Env, msg: OutgoingEmail): Promise<void> {
  const { token, email } = await getValidAccessToken(env);
  const from = msg.fromName ? `${encodeHeader(msg.fromName)} <${email}>` : email;

  const mime = [
    `From: ${from}`,
    `To: ${msg.to}`,
    `Subject: ${encodeHeader(msg.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    msg.html,
  ].join("\r\n");

  const res = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: base64Url(mime) }),
  });
  if (!res.ok) {
    const detail = await res.text();
    if (res.status === 403 && detail.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
      throw new Error(
        "Gmail has not granted permission to send email. Go to Invoice settings, select Reconnect, and allow the Gmail send permission on Google's consent screen.",
      );
    }
    throw new Error(`Gmail send failed: ${res.status} ${detail}`);
  }
}
