import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { InlineArtifactCard } from "../InlineArtifactCard";
import type { DiscussionEntryAttachment } from "../../../api/discussions";

function makeAttachment(overrides: Partial<DiscussionEntryAttachment> = {}): DiscussionEntryAttachment {
  return {
    id: "att-1",
    assetId: null,
    artifactId: "art-1",
    artifactType: "document",
    artifactTitle: "Onboarding plan",
    ...overrides,
  };
}

describe("InlineArtifactCard", () => {
  it("renders an attachment with title + type label", () => {
    renderWithProviders(
      <InlineArtifactCard attachments={[makeAttachment()]} />,
    );
    expect(screen.getByTestId("inline-artifact-card")).toBeInTheDocument();
    expect(screen.getByText("Onboarding plan")).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
  });

  it("fires onOpen with the artifactId when clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <InlineArtifactCard
        attachments={[makeAttachment({ id: "att-1", artifactId: "art-1" })]}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByTestId("inline-artifact-card-att-1"));
    expect(onOpen).toHaveBeenCalledWith("art-1");
  });

  it("renders multiple attachments", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[
          makeAttachment({ id: "a1", artifactTitle: "First" }),
          makeAttachment({ id: "a2", artifactTitle: "Second" }),
        ]}
      />,
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders empty when given no attachments", () => {
    const { container } = renderWithProviders(<InlineArtifactCard attachments={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an asset-only attachment as a generic File card", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[
          makeAttachment({
            id: "asset-att",
            artifactId: null,
            artifactType: null,
            artifactTitle: null,
            assetId: "asset-1",
          }),
        ]}
      />,
    );
    expect(screen.getByText("Attached file")).toBeInTheDocument();
    expect(screen.getByText("File")).toBeInTheDocument();
  });
});
