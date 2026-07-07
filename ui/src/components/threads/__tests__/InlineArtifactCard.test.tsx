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

  it("fires onOpen with the attachment when clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const attachment = makeAttachment({ id: "att-1", artifactId: "art-1" });
    renderWithProviders(
      <InlineArtifactCard
        attachments={[attachment]}
        onOpen={onOpen}
      />,
    );
    await user.click(screen.getByTestId("inline-artifact-card-att-1"));
    expect(onOpen).toHaveBeenCalledWith(attachment);
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

  it("renders an asset-only attachment as a file chip", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[
          makeAttachment({
            id: "asset-att",
            artifactId: null,
            artifactType: null,
            artifactTitle: null,
            assetId: "asset-1",
            assetOriginalFilename: "notes.txt",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("artifact-file-chip")).toBeInTheDocument();
    expect(screen.getByText("notes.txt")).toBeInTheDocument();
  });

  it("opens an asset-only attachment when clicked", async () => {
    const onOpen = vi.fn();
    const user = userEvent.setup();
    const attachment = makeAttachment({
      id: "asset-att",
      artifactId: null,
      artifactType: null,
      artifactTitle: null,
      assetId: "asset-1",
      assetOriginalFilename: "screenshot.png",
    });
    renderWithProviders(<InlineArtifactCard attachments={[attachment]} onOpen={onOpen} />);
    await user.click(screen.getByTestId("inline-artifact-card-asset-att"));
    expect(onOpen).toHaveBeenCalledWith(attachment);
  });

  it("renders a file chip for an artifact whose current version is asset-backed", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[
          makeAttachment({
            id: "file-att", artifactId: "art-file", artifactType: "design", artifactTitle: "Brand deck",
            currentVersionStorageKind: "asset", currentVersionFilename: "deck.pdf",
            currentVersionContentType: "application/pdf", currentVersionByteSize: 2048, currentVersionAssetId: "asset-9",
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("artifact-file-chip")).toBeInTheDocument();
    expect(screen.getByText("deck.pdf")).toBeInTheDocument();
    expect(screen.getByTestId("artifact-download")).toHaveAttribute("href", "/api/assets/asset-9/content");
  });

  it("renders a file chip for a direct asset attachment", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[
          makeAttachment({
            id: "raw-asset", artifactId: null, artifactType: null, artifactTitle: null,
            assetId: "asset-7", assetContentType: "image/png", assetOriginalFilename: "shot.png", assetByteSize: 512,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId("artifact-file-chip")).toBeInTheDocument();
    expect(screen.getByText("shot.png")).toBeInTheDocument();
  });

  it("does NOT render a file chip for an inline (text) artifact — regression", () => {
    renderWithProviders(
      <InlineArtifactCard
        attachments={[makeAttachment({ id: "inline-att", artifactId: "art-inline", artifactType: "document", artifactTitle: "Spec", currentVersionStorageKind: "inline" })]}
      />,
    );
    expect(screen.queryByTestId("artifact-file-chip")).not.toBeInTheDocument();
    expect(screen.getByText("Spec")).toBeInTheDocument();
    expect(screen.getByText("Document")).toBeInTheDocument();
  });

  it("shows the archive action only when canManage is true (active artifact)", () => {
    const { rerender } = renderWithProviders(
      <InlineArtifactCard attachments={[makeAttachment({ artifactId: "art-1", artifactStatus: "active" })]} />,
    );
    expect(screen.queryByTestId("artifact-archive")).not.toBeInTheDocument();
    rerender(
      <InlineArtifactCard attachments={[makeAttachment({ artifactId: "art-1", artifactStatus: "active" })]} canManage onArchiveArtifact={vi.fn()} onUnarchiveArtifact={vi.fn()} />,
    );
    expect(screen.getByTestId("artifact-archive")).toBeInTheDocument();
  });
  it("does not show lifecycle actions for draft artifacts", () => {
    renderWithProviders(
      <InlineArtifactCard attachments={[makeAttachment({ artifactId: "art-1", artifactStatus: "draft" })]} canManage onArchiveArtifact={vi.fn()} onUnarchiveArtifact={vi.fn()} />,
    );
    expect(screen.queryByTestId("artifact-archive")).not.toBeInTheDocument();
    expect(screen.queryByTestId("artifact-unarchive")).not.toBeInTheDocument();
  });
  it("shows the unarchive action when the artifact is archived", () => {
    renderWithProviders(
      <InlineArtifactCard attachments={[makeAttachment({ artifactId: "art-1", artifactStatus: "archived" })]} canManage onArchiveArtifact={vi.fn()} onUnarchiveArtifact={vi.fn()} />,
    );
    expect(screen.getByTestId("artifact-unarchive")).toBeInTheDocument();
    expect(screen.queryByTestId("artifact-archive")).not.toBeInTheDocument();
  });
  it("fires onArchiveArtifact with the artifactId", async () => {
    const user = userEvent.setup();
    const onArchiveArtifact = vi.fn();
    renderWithProviders(
      <InlineArtifactCard attachments={[makeAttachment({ artifactId: "art-1", artifactStatus: "active" })]} canManage onArchiveArtifact={onArchiveArtifact} onUnarchiveArtifact={vi.fn()} />,
    );
    await user.click(screen.getByTestId("artifact-archive"));
    expect(onArchiveArtifact).toHaveBeenCalledWith("art-1");
  });
});
