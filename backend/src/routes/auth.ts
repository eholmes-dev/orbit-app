import { Router } from "express";
import { prisma } from "../db.js";
import { asyncHandler, HttpError } from "../middleware/error.js";
import { encrypt, newSessionId } from "../lib/crypto.js";
import {
  authorizeUrl,
  exchangeCode,
  fetchGraphMe,
  newPkce,
  newState,
} from "../lib/oauth.js";
import { COOKIE_NAME } from "../middleware/session.js";

const APP_BASE_URL = process.env.APP_BASE_URL ?? "http://localhost:5173";
const PENDING_COOKIE = "orbit_oauth_pending";
const isProd = process.env.NODE_ENV === "production";

export const authRouter = Router();

// Kick off the OAuth flow: stash PKCE verifier + state in a short-lived cookie,
// redirect to Microsoft's authorize endpoint.
authRouter.get(
  "/login",
  asyncHandler(async (_req, res) => {
    const state = newState();
    const { verifier, challenge } = newPkce();

    res.cookie(PENDING_COOKIE, JSON.stringify({ state, verifier }), {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 5 * 60 * 1000,
      path: "/",
    });

    res.redirect(authorizeUrl(state, challenge));
  }),
);

// Receives the auth code from Microsoft, exchanges for tokens, creates a session,
// sets the session cookie, redirects to the frontend.
authRouter.get(
  "/callback",
  asyncHandler(async (req, res) => {
    const { code, state, error: oauthError, error_description } = req.query;

    if (oauthError) {
      res
        .status(400)
        .send(`OAuth error: ${oauthError} — ${error_description ?? ""}`);
      return;
    }

    if (typeof code !== "string" || typeof state !== "string") {
      throw new HttpError(400, "Missing code or state");
    }

    const pendingRaw = req.cookies?.[PENDING_COOKIE];
    if (!pendingRaw) {
      throw new HttpError(
        400,
        "No pending OAuth state (cookie missing or expired). Restart sign-in.",
      );
    }

    let pending: { state: string; verifier: string };
    try {
      pending = JSON.parse(pendingRaw);
    } catch {
      throw new HttpError(400, "Malformed pending OAuth cookie");
    }
    if (pending.state !== state) throw new HttpError(400, "State mismatch");

    res.clearCookie(PENDING_COOKIE);

    const tokens = await exchangeCode(code, pending.verifier);
    if (!tokens.refresh_token) {
      throw new HttpError(
        500,
        "Microsoft did not return a refresh_token. Confirm offline_access is granted.",
      );
    }
    const me = await fetchGraphMe(tokens.access_token);

    const sessionId = newSessionId();
    await prisma.session.create({
      data: {
        id: sessionId,
        msUserId: me.id,
        email: me.mail ?? me.userPrincipalName,
        name: me.displayName,
        accessToken: encrypt(tokens.access_token),
        refreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    res.cookie(COOKIE_NAME, sessionId, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 30 * 24 * 60 * 60 * 1000,
      path: "/",
    });

    res.redirect(APP_BASE_URL);
  }),
);

// Always 200; returns { user: ... | null }. Lets the frontend treat unauth as
// "not signed in" rather than as an error.
authRouter.get("/me", (req, res) => {
  if (!req.user) {
    res.json({ user: null });
    return;
  }
  res.json({
    user: {
      id: req.user.msUserId,
      email: req.user.email,
      name: req.user.name,
    },
  });
});

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    if (req.user) {
      await prisma.session.delete({ where: { id: req.user.sessionId } });
    }
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  }),
);
