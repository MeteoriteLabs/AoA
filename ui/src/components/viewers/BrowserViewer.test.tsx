import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BrowserViewer } from "./BrowserViewer";

afterEach(cleanup);

describe("BrowserViewer scheme safety", () => {
  it("never renders a dangerous initialUrl as the iframe src", () => {
    const { queryByTestId } = render(<BrowserViewer initialUrl="javascript:alert(1)" />);
    const iframe = queryByTestId("thread-browser-iframe") as HTMLIFrameElement | null;
    expect(iframe?.getAttribute("src") ?? "about:blank").not.toContain("javascript:");
  });
  it("renders a safe initialUrl as the iframe src", () => {
    const { getByTestId } = render(<BrowserViewer initialUrl="https://example.com" />);
    expect(getByTestId("thread-browser-iframe").getAttribute("src")).toBe("https://example.com");
  });
});
