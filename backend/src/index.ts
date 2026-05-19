import path from "node:path";
import fs from "node:fs";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { prisma } from "./db.js";
import { peopleRouter } from "./routes/people.js";
import { labelsRouter } from "./routes/labels.js";
import { eventsRouter } from "./routes/events.js";
import { availabilityRouter } from "./routes/availability.js";
import { scheduleRouter } from "./routes/schedule.js";
import { overrideRouter } from "./routes/override.js";
import { authRouter } from "./routes/auth.js";
import { sessionMiddleware, requireAuth } from "./middleware/session.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const app = express();
const port = Number(process.env.BACKEND_PORT ?? 4000);

app.use(cors({ origin: ["http://localhost:5173"], credentials: true }));
app.use(cookieParser());
app.use(express.json());
app.use(sessionMiddleware);

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("DB health check failed:", err);
    res.status(503).json({ status: "degraded", db: "disconnected" });
  }
});

app.use("/api/auth", authRouter);
// Public — email recipients aren't signed in; URL token is the bearer secret.
app.use("/api/override", overrideRouter);

// Everything below requires a valid session.
app.use("/api/people", requireAuth, peopleRouter);
app.use("/api/labels", requireAuth, labelsRouter);
app.use("/api/events", requireAuth, eventsRouter);
app.use("/api/availability", requireAuth, availabilityRouter);
app.use("/api/schedule", requireAuth, scheduleRouter);

// Bundled-Docker mode: serve the built frontend from this same Express
// process so the whole app runs on one origin (no CORS, no separate
// nginx). The STATIC_DIR env var is set by the Docker image's runtime
// stage; in `npm run dev` it's unset and this whole branch is skipped,
// leaving Vite to serve the frontend on :5173.
if (process.env.STATIC_DIR) {
  const staticDir = path.resolve(process.env.STATIC_DIR);
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    // Client-side routing: any non-/api GET falls back to index.html so
    // deep links like /schedule reload cleanly.
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(staticDir, "index.html"));
    });
    console.log(`[backend] serving frontend from ${staticDir}`);
  } else {
    console.warn(
      `[backend] STATIC_DIR=${staticDir} set but directory missing — frontend will not be served`,
    );
  }
}

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
});
