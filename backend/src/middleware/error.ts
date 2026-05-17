import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Wraps async route handlers so thrown errors reach the error middleware.
export const asyncHandler =
  <T extends RequestHandler>(fn: T): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: "ValidationError",
      issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({
        error: "UniqueConstraintViolation",
        target: err.meta?.target,
        message: "A record with these values already exists.",
      });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ error: "NotFound", message: "Record not found." });
      return;
    }
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({ error: "InternalServerError" });
};

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "NotFound", message: "Route not found." });
};
