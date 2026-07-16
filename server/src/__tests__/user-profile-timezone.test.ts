import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertUserProfile = vi.hoisted(() => vi.fn(async (_db: unknown, _userId: string, input: unknown) => ({
  userId: "u1",
  displayName: "Ada",
  avatarUrl: null,
  title: "Engineer",
  bio: null,
  timezone: (input as { timezone?: string | null }).timezone ?? null,
  socialLinks: [],
})));
vi.mock("../services/user-profiles.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/user-profiles.js")>()),
  upsertUserProfile,
}));

import { userProfileRoutes } from "../routes/user-profiles.js";

function findRoute(router: ReturnType<typeof userProfileRoutes>, method: "patch") {
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean>; stack: Array<{ handle: unknown }> } }> }).stack
    .find((l) => l.route?.path === "/user-profile" && l.route.methods[method]);
  if (!layer?.route) throw new Error("route not found");
  return layer.route.stack[0]!.handle as (req: unknown, res: unknown) => Promise<void>;
}

describe("PATCH /user-profile accepts timezone", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a string timezone to the upsert", async () => {
    const handler = findRoute(userProfileRoutes({} as never), "patch");
    const json = vi.fn();
    await handler(
      { actor: { type: "board", userId: "u1" }, body: { displayName: "Ada", timezone: "Asia/Kolkata" } },
      { json, status: vi.fn().mockReturnValue({ json }) },
    );
    expect(upsertUserProfile).toHaveBeenCalledWith(expect.anything(), "u1",
      expect.objectContaining({ timezone: "Asia/Kolkata" }));
  });
});
