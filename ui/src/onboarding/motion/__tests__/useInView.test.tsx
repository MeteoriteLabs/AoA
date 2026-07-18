import { describe, it, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { useInView } from "../useInView";

let capturedCallback: IntersectionObserverCallback | undefined;
let capturedOptions: IntersectionObserverInit | undefined;
let lastInstance: MockIntersectionObserver | undefined;

class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    capturedCallback = cb;
    capturedOptions = options;
    lastInstance = this;
  }
}

function TestComponent({ once }: { once?: boolean }) {
  const [ref, inView] = useInView({ once, margin: "-100px" });
  return (
    <div ref={ref as (node: HTMLDivElement | null) => void} data-testid="target">
      {inView ? "in" : "out"}
    </div>
  );
}

describe("useInView", () => {
  it("starts out of view and flips to in-view when the observer reports an intersection", () => {
    const original = window.IntersectionObserver;
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

    const { getByTestId } = render(<TestComponent />);
    expect(getByTestId("target").textContent).toBe("out");

    act(() => {
      capturedCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(getByTestId("target").textContent).toBe("in");
    expect(capturedOptions?.rootMargin).toBe("-100px");
    window.IntersectionObserver = original;
  });

  it("`once` disconnects the observer after the first intersection", () => {
    const original = window.IntersectionObserver;
    window.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;

    render(<TestComponent once />);
    act(() => {
      capturedCallback!(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });

    expect(lastInstance?.disconnect).toHaveBeenCalled();
    window.IntersectionObserver = original;
  });
});
