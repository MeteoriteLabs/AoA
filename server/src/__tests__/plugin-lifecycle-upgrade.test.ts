import { describe, it, expect } from "vitest";
import { diffCapabilities } from "../services/plugin-lifecycle.js";

describe("plugin lifecycle upgrade helpers", () => {
  it("detects no new capabilities when sets are equal", () => {
    const delta = diffCapabilities(
      ["tools.register", "http.outbound"],
      ["tools.register", "http.outbound"],
    );
    expect(delta).toEqual([]);
  });

  it("detects newly added capabilities", () => {
    const delta = diffCapabilities(
      ["tools.register"],
      ["tools.register", "storage.write", "webhooks.listen"],
    );
    expect(delta).toEqual(["storage.write", "webhooks.listen"]);
  });

  it("does not flag removed capabilities (backward compat is OK)", () => {
    const delta = diffCapabilities(
      ["tools.register", "http.outbound"],
      ["tools.register"],
    );
    expect(delta).toEqual([]);
  });
});
