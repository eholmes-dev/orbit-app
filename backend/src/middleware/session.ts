import type { RequestHandler } from "express";
import { prisma } from "../db.js";

export const COOKIE_NAME = "orbit_session";

declare module "express-serve-static-core" {
  interface Request {
    user?: {
      sessionId: string;
      msUserId: string;
      email: string;
      name: string;
    };
  }
}

/**
 * Reads the session cookie, loads the Session row, attaches `req.user` if valid.
 * Never blocks — auth enforcement is the job of `requireAuth` on individual routes.
 */
export const sessionMiddleware: RequestHandler = async (req, res, next) => {
  try {
    const sessionId = req.cookies?.[COOKIE_NAME];
    if (!sessionId) return next();

    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      res.clearCookie(COOKIE_NAME);
      return next();
    }

    req.user = {
      sessionId: session.id,
      msUserId: session.msUserId,
      email: session.email,
      name: session.name,
    };
    next();
  } catch (err) {
    next(err);
  }
};

export const requireAuth: RequestHandler = (req, res, next) => {
  if (!req.user) {
    res.status(401).json({ error: "Unauthenticated" });
    return;
  }
  next();
};
