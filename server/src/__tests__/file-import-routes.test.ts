import { describe, it, expect } from "vitest";

describe("fileImportRoutes contract", () => {
  it("exports a fileImportRoutes factory function", async () => {
    const mod = await import("../routes/file-import.js").catch(() => null);
    expect(mod).not.toBeNull();
    expect(typeof mod?.fileImportRoutes).toBe("function");
  });
});
