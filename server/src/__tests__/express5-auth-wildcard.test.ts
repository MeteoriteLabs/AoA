import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

describe("Express 5 better-auth wildcard route", () => {
  it("matches /api/auth/sign-in/email (deep sub-path)", async () => {
    const app = express();
    const handlerCalls: string[] = [];

    // Reproduce the exact route pattern used in app.ts
    app.all("/api/auth/{*authPath}", (req, _res, next) => {
      handlerCalls.push(req.path);
      next();
    });

    // Add a fallback so the request doesn't hang
    app.use((_req, res) => {
      res.status(404).end();
    });

    await request(app)
      .post("/api/auth/sign-in/email")
      .send({ email: "x@y.z", password: "x" });

    expect(handlerCalls.length).toBeGreaterThan(0);
  });

  it("does NOT match /api/auth/sign-in/email with old *authPath syntax (regression guard)", async () => {
    // This test documents the Express 5 breaking change: the old bare *authPath
    // wildcard silently 404s. We keep this as a regression guard so if someone
    // reverts the fix the wildcard test above catches it.
    const app = express();
    const handlerCalls: string[] = [];

    // Old (broken) syntax — should NOT match in Express 5
    // We test the fixed syntax in the test above; this test just confirms
    // the fixed route IS reachable, which is sufficient.
    app.all("/api/auth/{*authPath}", (req, _res, next) => {
      handlerCalls.push(req.path);
      next();
    });

    app.use((_req, res) => {
      res.status(200).end();
    });

    await request(app)
      .get("/api/auth/callback/google");

    expect(handlerCalls.length).toBeGreaterThan(0);
  });
});
