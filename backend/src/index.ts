import express from "express";
import cors from "cors";
import { prisma } from "./db.js";
import { peopleRouter } from "./routes/people.js";
import { labelsRouter } from "./routes/labels.js";
import { eventsRouter } from "./routes/events.js";
import { availabilityRouter } from "./routes/availability.js";
import { scheduleRouter } from "./routes/schedule.js";
import { errorHandler, notFoundHandler } from "./middleware/error.js";

const app = express();
const port = Number(process.env.BACKEND_PORT ?? 4000);

app.use(cors({ origin: ["http://localhost:5173"] }));
app.use(express.json());

app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected" });
  } catch (err) {
    console.error("DB health check failed:", err);
    res.status(503).json({ status: "degraded", db: "disconnected" });
  }
});

app.use("/api/people", peopleRouter);
app.use("/api/labels", labelsRouter);
app.use("/api/events", eventsRouter);
app.use("/api/availability", availabilityRouter);
app.use("/api/schedule", scheduleRouter);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(port, () => {
  console.log(`[backend] listening on http://localhost:${port}`);
});
