import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../../__tests__/test-utils";
import { AuthPage } from "../Auth";

const mockNavigate = vi.fn();
const routerState = vi.hoisted(() => ({ searchParams: new URLSearchParams("next=/onboarding") }));
vi.mock("@/lib/router", () => ({
  useNavigate: () => mockNavigate,
  useSearchParams: () => [routerState.searchParams],
}));

const getSession = vi.hoisted(() => vi.fn());
const signInSocial = vi.hoisted(() =>
  vi.fn(async () => ({ url: "https://accounts.google.com" })),
);
vi.mock("../../api/auth", () => ({
  authApi: {
    getSession: (...a: unknown[]) => getSession(...a),
    signInSocial: (...a: unknown[]) => signInSocial(...a),
  },
}));

// The ASCII animation drives a canvas/RAF loop that jsdom can't run.
vi.mock("@/components/AsciiArtAnimation", () => ({ AsciiArtAnimation: () => null }));

describe("AuthPage", () => {
  const reloadSpy = vi.fn();
  const originalLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    routerState.searchParams = new URLSearchParams("next=/onboarding");
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

  it.each([
    "https://evil.example/phish",
    "//evil.example/phish",
    String.raw`\\evil.example\phish`,
    "javascript:alert(1)",
  ])("does not redirect an existing session to an unsafe next target: %s", async (next) => {
    routerState.searchParams = new URLSearchParams({ next });
    getSession.mockResolvedValue({ user: { id: "u1" } });

    renderWithProviders(<AuthPage />);

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true }));
  });

  it("does not send an unsafe next target to the OAuth callback", async () => {
    routerState.searchParams = new URLSearchParams({ next: "https://evil.example/phish" });

    renderWithProviders(<AuthPage />);
    await screen.findByText("Continue with Google");
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    await waitFor(() => expect(signInSocial).toHaveBeenCalledWith("google", "/"));
  });
});
