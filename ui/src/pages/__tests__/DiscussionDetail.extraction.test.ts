/**
 * Unit tests for the extraction failure copy helper in DiscussionDetail.
 *
 * We test the pure `extractionFailureMessage` function for every CLI kind
 * and the legacy fallback. This approach avoids the complexity of rendering
 * the full DiscussionDetail page (which requires many mocked contexts) while
 * still verifying the exact copy that will appear in
 * data-testid="extraction-failure-banner".
 */
import { describe, it, expect } from "vitest";
import { extractionFailureMessage } from "../DiscussionDetail";

describe("extractionFailureMessage", () => {
  describe("CLI kind: not_installed", () => {
    it("returns CLI-agnostic install guidance when no message is stored", () => {
      const result = extractionFailureMessage("not_installed", null);
      expect(result.primary).toContain("CLI not detected");
      // Must NOT hardcode Claude — codex companies would be misdirected.
      expect(result.primary).not.toContain("Claude CLI");
      expect(result.showSettings).toBe(false);
    });

    it("prefers the server's CLI-specific message (e.g. codex)", () => {
      const result = extractionFailureMessage("not_installed", "codex CLI not found");
      expect(result.primary).toBe("codex CLI not found");
      expect(result.showSettings).toBe(false);
    });
  });

  describe("CLI kind: not_authed", () => {
    it("returns CLI-agnostic login guidance when no message is stored", () => {
      const result = extractionFailureMessage("not_authed", null);
      expect(result.primary).toContain("not logged in");
      expect(result.primary).not.toContain("claude login");
      expect(result.showSettings).toBe(false);
    });

    it("prefers the server's CLI-specific message", () => {
      const result = extractionFailureMessage("not_authed", "codex not authenticated");
      expect(result.primary).toBe("codex not authenticated");
      expect(result.showSettings).toBe(false);
    });
  });

  describe("CLI kind: timeout", () => {
    it("returns timeout copy with Reprocess hint", () => {
      const result = extractionFailureMessage("timeout", null);
      expect(result.primary).toContain("timed out");
      expect(result.primary).toContain("Reprocess");
      expect(result.showSettings).toBe(false);
    });
  });

  describe("CLI kind: nonzero_exit", () => {
    it("returns generic failed copy with Reprocess hint", () => {
      const result = extractionFailureMessage("nonzero_exit", "exit code 1");
      expect(result.primary).toContain("try Reprocess");
      expect(result.showSettings).toBe(false);
    });

    it("includes the raw message", () => {
      const result = extractionFailureMessage("nonzero_exit", "exit code 1");
      expect(result.primary).toContain("exit code 1");
    });
  });

  describe("CLI kind: unparseable", () => {
    it("returns generic failed copy with Reprocess hint", () => {
      const result = extractionFailureMessage("unparseable", "unexpected output");
      expect(result.primary).toContain("try Reprocess");
      expect(result.showSettings).toBe(false);
    });
  });

  describe("legacy / unknown kind (null)", () => {
    it("returns the raw message as primary copy", () => {
      const result = extractionFailureMessage(null, "Something went wrong.");
      expect(result.primary).toBe("Something went wrong.");
    });

    // Extraction is CLI-only (Decision #104, amended 2026-06-27): it never reads
    // a hosted key, so failures never point at a provider key / Settings.
    // showSettings is always false — even for legacy api-key/provider strings.
    it("never shows a Settings link, even when message mentions api key", () => {
      const result = extractionFailureMessage(null, "No api key configured.");
      expect(result.showSettings).toBe(false);
    });

    it("never shows a Settings link, even when message mentions provider", () => {
      const result = extractionFailureMessage(null, "No LLM provider configured.");
      expect(result.showSettings).toBe(false);
    });

    it("sets showSettings=false for generic messages", () => {
      const result = extractionFailureMessage(null, "Content too short to extract from.");
      expect(result.showSettings).toBe(false);
    });

    it("falls back gracefully when both kind and message are null", () => {
      const result = extractionFailureMessage(null, null);
      expect(typeof result.primary).toBe("string");
      expect(result.showSettings).toBe(false);
    });
  });

  describe("cloud (multiTenant) credential-shaped failures", () => {
    // NOTE: This INVERTS the earlier D3/#27 "point cloud founders at
    // Settings → Providers" copy. That copy was built on the wrong premise that
    // a per-company provider key enables extraction. It does not: extraction is
    // CLI-only (Decision #104 / CLAUDE.md Rule #11) and never reads a provider
    // key. On the shared cloud host there is no CLI login to run and a provider
    // key would not help, so a credential-shaped extraction failure means
    // extraction is simply unavailable there — no actionable Settings path.
    it("not_authed in cloud says extraction is unavailable, NOT set a provider key", () => {
      const result = extractionFailureMessage(
        "not_authed",
        "claude CLI is not authenticated. Run the CLI's login flow, then retry.",
        { multiTenant: true },
      );
      expect(result.primary).not.toMatch(/Settings\s*→\s*Providers/);
      expect(result.primary).toMatch(/AoA Cloud/);
      expect(result.primary).not.toMatch(/login flow|Run the CLI|not logged in/i);
      expect(result.showSettings).toBe(false);
    });

    it("not_installed in cloud says extraction is unavailable, NOT set a provider key", () => {
      const result = extractionFailureMessage(
        "not_installed",
        "claude CLI not found on PATH. Install the Claude Code CLI and ensure it is on your PATH.",
        { multiTenant: true },
      );
      expect(result.primary).not.toMatch(/Settings\s*→\s*Providers/);
      expect(result.primary).toMatch(/AoA Cloud/);
      expect(result.primary).not.toMatch(/PATH|Install the/i);
      expect(result.showSettings).toBe(false);
    });

    it("does NOT rewrite non-credential kinds in cloud (timeout/nonzero_exit)", () => {
      expect(extractionFailureMessage("timeout", null, { multiTenant: true }).showSettings).toBe(false);
      const nz = extractionFailureMessage("nonzero_exit", "exit code 1", { multiTenant: true });
      expect(nz.primary).toContain("try Reprocess");
      expect(nz.showSettings).toBe(false);
    });

    it("self-hosted (default / multiTenant:false) keeps the CLI copy verbatim", () => {
      const dflt = extractionFailureMessage("not_authed", null);
      expect(dflt.primary).toContain("not logged in");
      expect(dflt.showSettings).toBe(false);
      const explicit = extractionFailureMessage("not_authed", null, { multiTenant: false });
      expect(explicit.primary).toContain("not logged in");
      expect(explicit.showSettings).toBe(false);
    });
  });
});
