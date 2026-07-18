import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ConstellationBg } from "../ConstellationBg";

function mock2dContext() {
  return {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

describe("ConstellationBg", () => {
  let getContextSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    getContextSpy = vi
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => mock2dContext());
  });

  afterEach(() => {
    getContextSpy.mockRestore();
  });

  it("renders a canvas", () => {
    const { container } = render(<ConstellationBg />);
    expect(container.querySelector("canvas")).toBeTruthy();
  });

  it("does not throw when the 2d context is unavailable (jsdom has no real canvas)", () => {
    getContextSpy.mockImplementation(() => null);
    expect(() => render(<ConstellationBg />)).not.toThrow();
  });

  it("cleans up its rAF, timers, and listeners on unmount", () => {
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(42);
    const cancelSpy = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const removeListenerSpy = vi.spyOn(window, "removeEventListener");

    const { unmount } = render(<ConstellationBg />);
    unmount();

    expect(cancelSpy).toHaveBeenCalledWith(42);
    expect(removeListenerSpy).toHaveBeenCalledWith("resize", expect.any(Function));

    rafSpy.mockRestore();
    cancelSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it("observes and disconnects a ResizeObserver on the canvas", () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    const unobserve = vi.fn();
    class RO {
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
    const original = window.ResizeObserver;
    window.ResizeObserver = RO as unknown as typeof ResizeObserver;

    const { unmount } = render(<ConstellationBg />);
    expect(observe).toHaveBeenCalled();
    unmount();
    expect(disconnect).toHaveBeenCalled();

    window.ResizeObserver = original;
  });
});
