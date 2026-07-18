import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTypewriter } from "../useTypewriter";

describe("useTypewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("types out the string one character at a time at 55ms/char", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    const { result } = renderHook(() => useTypewriter("Hi!"));
    expect(result.current).toBe("");

    act(() => {
      vi.advanceTimersByTime(55);
    });
    expect(result.current).toBe("H");

    act(() => {
      vi.advanceTimersByTime(55);
    });
    expect(result.current).toBe("Hi");

    act(() => {
      vi.advanceTimersByTime(55);
    });
    expect(result.current).toBe("Hi!");
  });

  it("returns the full string immediately under reduced motion", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
    );
    const { result } = renderHook(() => useTypewriter("Hello"));
    expect(result.current).toBe("Hello");
  });
});
