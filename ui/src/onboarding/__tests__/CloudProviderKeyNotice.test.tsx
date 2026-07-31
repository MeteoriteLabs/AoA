import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CloudProviderKeyNotice } from "../CloudProviderKeyNotice";

describe("CloudProviderKeyNotice", () => {
  it("routes to Settings -> Providers on cloud_auth", () => {
    render(<CloudProviderKeyNotice deploymentMode="cloud_auth" />);
    const link = screen.getByRole("link", { name: /providers/i });
    expect(link.getAttribute("href")).toBe("/settings?tab=providers");
    // Guidance is non-blocking / advisory.
    expect(screen.getByTestId("cloud-provider-key-notice").textContent).toMatch(
      /isn't required|not required/i,
    );
  });

  it("renders nothing on self-hosted (local_trusted)", () => {
    const { container } = render(<CloudProviderKeyNotice deploymentMode="local_trusted" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when deploymentMode is undefined (legacy/self-hosted)", () => {
    const { container } = render(<CloudProviderKeyNotice />);
    expect(container).toBeEmptyDOMElement();
  });
});
