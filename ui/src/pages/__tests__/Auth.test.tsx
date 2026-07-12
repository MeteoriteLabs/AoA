import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../__tests__/test-utils";
import { AuthPage } from "../Auth";

const mockNavigate = vi.fn();
vi.mock("@/lib/router", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams("next=/onboarding")],
}));

const getSession = vi.hoisted(() => vi.fn());
vi.mock("../../api/auth", () => ({
  authApi: {
    getSession: (...a: unknown[]) => getSession(...a),
    signInSocial: vi.fn(async () => ({ url: "https://accounts.google.com" })),
  },
}));

// The ASCII animation drives a canvas/RAF loop that jsdom can't run.
vi.mock("@/components/AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));

describe("AuthPage", () => {
  const reloadSpy = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(null);
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { href: "http://localhost/auth", assign: vi.fn(), reload: reloadSpy },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  function firePageShow(persisted: boolean) {
    const ev = new Event("pageshow");
    Object.defineProperty(ev, "persisted", { value: persisted });
    window.dispatchEvent(ev);
  }

  it("reloads on a bfcache restore so a stale 'Redirecting…' can't persist (live-QA)", async () => {
    renderWithProviders(<AuthPage />);
    await screen.findByText("Continue with Google");
    firePageShow(true);
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT reload on a normal (non-bfcache) pageshow", async () => {
    renderWithProviders(<AuthPage />);
    await screen.findByText("Continue with Google");
    firePageShow(false);
    expect(reloadSpy).not.toHaveBeenCalled();
  });

  it("bounces an already-signed-in user to the next path", async () => {
    getSession.mockResolvedValue({ user: { id: "u1" } });
    renderWithProviders(<AuthPage />);
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/onboarding", { replace: true }),
    );
  });
});
