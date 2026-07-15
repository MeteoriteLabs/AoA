import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ComposerFrame } from "./ComposerFrame";

describe("ComposerFrame", () => {
  it("keeps the shared frame anatomy and density contract", () => {
    render(<ComposerFrame density="compact" data-testid="composer-frame"><span>editor</span></ComposerFrame>);
    const frame = screen.getByTestId("composer-frame");
    expect(frame).toHaveAttribute("data-composer-frame");
    expect(frame).toHaveAttribute("data-density", "compact");
    expect(frame).toHaveTextContent("editor");
  });
});
