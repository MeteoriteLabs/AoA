import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("LobbyOrOnboardingRedirect invitation handoff", () => {
  it("passes returning users' pending invitations into Lobby", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        process.cwd().endsWith("ui") ? "src/App.tsx" : "ui/src/App.tsx"
      ),
      "utf8"
    );
    expect(source).toContain(
      "<Lobby pendingInvitations={data?.pendingInvitations ?? []} />"
    );
  });

  it("resolves the post-auth journey before mounting the lobby layout", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        process.cwd().endsWith("ui") ? "src/App.tsx" : "ui/src/App.tsx"
      ),
      "utf8"
    );
    expect(
      source.indexOf("<Route element={<PostAuthJourneyGate />}>")
    ).toBeLessThan(source.indexOf("<Route element={<LobbyLayout />}>"));
    expect(source).toContain(
      '<Route path="access-required" element={<AccessRequiredPage />} />'
    );
  });
});
