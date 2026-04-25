import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThemeProvider } from "../context/ThemeContext";
import { MarkdownBody } from "../components/MarkdownBody";

// MarkdownBody uses react-markdown + remark-gfm; both work fine in jsdom.
// No other providers are needed.

vi.mock("../context/ThemeContext", async () => {
  const actual = await vi.importActual<typeof import("../context/ThemeContext")>(
    "../context/ThemeContext",
  );
  return actual;
});

function renderBody(markdown: string) {
  return render(
    <ThemeProvider>
      <MarkdownBody>{markdown}</MarkdownBody>
    </ThemeProvider>,
  );
}

describe("MarkdownBody — CSS class rename (paperclip- → aoa-)", () => {
  it("renders a project mention link with class aoa-project-mention-chip", () => {
    // build a valid project:// href that parseProjectMentionHref will accept
    const href = "project://dev";
    const markdown = `see [Dev](${href})`;
    const { container } = renderBody(markdown);

    const chip = container.querySelector(".aoa-project-mention-chip");
    expect(chip).not.toBeNull();
  });

  it("does NOT emit any element whose class starts with paperclip-", () => {
    const href = "project://dev";
    const markdown = `see [Dev](${href})`;
    const { container } = renderBody(markdown);

    // querySelectorAll with attribute-contains selector to catch any paperclip- class
    const paperclipNodes = container.querySelectorAll('[class*="paperclip-"]');
    expect(paperclipNodes.length).toBe(0);
  });
});
