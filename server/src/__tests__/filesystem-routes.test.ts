import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { filesystemRoutes } from "../routes/filesystem.js";
import { errorHandler } from "../middleware/error-handler.js";

function makeApp(actor: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", filesystemRoutes());
  app.use(errorHandler);
  return app;
}

const nonAdminBoard = {
  type: "board",
  source: "session",
  userId: "user-A",
  companyIds: ["company-A"],
  isInstanceAdmin: false,
};
const localImplicit = { ...nonAdminBoard, source: "local_implicit" };
const instanceAdmin = { ...nonAdminBoard, isInstanceAdmin: true };

describe("filesystem routes — instance admin gate", () => {
  it("403 browse for non-admin board user", async () => {
    const res = await request(makeApp(nonAdminBoard)).get("/api/filesystem/browse?path=/tmp");
    expect(res.status).toBe(403);
  });
  it("403 mkdir for non-admin", async () => {
    const res = await request(makeApp(nonAdminBoard))
      .post("/api/filesystem/mkdir").send({ path: "/tmp/x" });
    expect(res.status).toBe(403);
  });
  it("403 reveal for non-admin", async () => {
    const res = await request(makeApp(nonAdminBoard))
      .post("/api/filesystem/reveal").send({ path: "/tmp" });
    expect(res.status).toBe(403);
  });
  it("403 drives for non-admin", async () => {
    const res = await request(makeApp(nonAdminBoard)).get("/api/filesystem/drives");
    expect(res.status).toBe(403);
  });
  it("403 home for non-admin", async () => {
    const res = await request(makeApp(nonAdminBoard)).get("/api/filesystem/home");
    expect(res.status).toBe(403);
  });
  it("not 403 for local_implicit (regression guard)", async () => {
    const res = await request(makeApp(localImplicit)).get("/api/filesystem/browse?path=/tmp");
    // May be 200 or 400 (path validation) or 500 (FS error in test env), but NEVER 403
    expect(res.status).not.toBe(403);
  });
  it("403 reveal for path outside home dir (instance admin)", async () => {
    const res = await request(makeApp(instanceAdmin))
      .post("/api/filesystem/reveal").send({ path: "/etc/passwd" });
    // Should be rejected with 400 (outside home) — never 200 or actually-spawn xdg-open
    expect([400, 403]).toContain(res.status);
  });
});
