import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MemoryChip } from "../MemoryChip";

describe("MemoryChip", () => {
  it("renders label", () => {
    const { container } = render(<MemoryChip label="Decision" />);
    expect(container.textContent).toContain("Decision");
  });

  it("renders a tinted dot when tone is provided", () => {
    const { container } = render(<MemoryChip label="Decision" tone="indigo" />);
    expect(container.querySelector('[data-slot="dot"]')).toBeInTheDocument();
  });

  it("omits the dot when tone is undefined", () => {
    const { container } = render(<MemoryChip label="image · 142 kB" />);
    expect(container.querySelector('[data-slot="dot"]')).toBeNull();
  });
});
