import { env } from "cloudflare:workers";
import { redirect } from "react-router";

import type { Route } from "./+types/google.callback";
import { requireAdmin } from "~/lib/auth.server";
import { emailFromIdToken, exchangeGoogleCode, hasGmailSendScope } from "~/lib/gmail.server";
import { googleCallbackRedirectUri, googleStateCookie } from "~/lib/google-oauth.server";
import { saveGoogleTokens } from "~/lib/google-tokens.server";

/** Google redirects here after consent: verify state, exchange code, persist. */
export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);

  const url = new URL(request.url);
  const clear = await googleStateCookie.serialize("", { maxAge: 0 });
  const back = (status: string) =>
    redirect(`/invoice-settings?google=${status}`, {
      headers: { "Set-Cookie": clear },
    });

  if (url.searchParams.get("error")) return back("error");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = (await googleStateCookie.parse(request.headers.get("Cookie"))) as
    string | null;

  if (!code || !state || !cookieState || state !== cookieState) {
    return back("error");
  }

  try {
    const tokens = await exchangeGoogleCode(env, code, googleCallbackRedirectUri(request));
    if (!hasGmailSendScope(tokens.scope)) return back("scope");
    const email = emailFromIdToken(tokens.id_token);
    if (!email || !tokens.refresh_token) return back("error");

    await saveGoogleTokens(env.DB, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      email,
    });
    return back("connected");
  } catch (err) {
    console.error("Google callback failed", err);
    return back("error");
  }
}
