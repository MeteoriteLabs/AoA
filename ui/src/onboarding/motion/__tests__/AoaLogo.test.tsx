import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AoaLogo } from "../AoaLogo";

describe("AoaLogo", () => {
  it("renders the AoA wordmark with a spinning ring and a dot by default", () => {
    const { container } = render(<AoaLogo size={40} />);
    expect(container.querySelector('[data-part="ring"]')).toBeTruthy();
    expect(container.querySelector('[data-part="dot"]')).toBeTruthy();
  });

  it("hideDot omits the breathing dot", () => {
    const { container } = render(<AoaLogo size={40} hideDot />);
    expect(container.querySelector('[data-part="dot"]')).toBeNull();
  });

  it("is decorative — exposes role=img with an aria-label, no redundant text exposure", () => {
    const { container } = render(<AoaLogo size={40} />);
    const root = container.firstChild as HTMLElement;
    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("AoA");
  });
});
