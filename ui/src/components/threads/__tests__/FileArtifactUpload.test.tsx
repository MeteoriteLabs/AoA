import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../../__tests__/test-utils";
import { FileArtifactUpload } from "../FileArtifactUpload";
import * as artifactsApi from "../../../api/artifacts";

// renderWithProviders does not wrap a ToastProvider; mock the hook the same way
// ThreadTab.test does, and capture pushToast to assert the failure path.
const { pushToast } = vi.hoisted(() => ({ pushToast: vi.fn() }));
vi.mock("../../../context/ToastContext", () => ({ useToast: () => ({ pushToast }) }));

beforeEach(() => {
  vi.restoreAllMocks();
  pushToast.mockClear();
});

describe("FileArtifactUpload", () => {
  it("uploads the picked file as an artifact and calls onUploaded", async () => {
    const artifact = { id: "art-1", companyId: "c1", title: "deck.pdf", description: null, type: "document", status: "draft", currentVersionId: "v1", createdAt: "", updatedAt: "" };
    const spy = vi.spyOn(artifactsApi, "uploadFileArtifact").mockResolvedValue(artifact);
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FileArtifactUpload companyId="c1" onUploaded={onUploaded} />);
    const file = new File(["x"], "deck.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("file-artifact-input"), file);
    expect(spy).toHaveBeenCalledWith("c1", file, { title: "deck.pdf", type: "document" });
    expect(onUploaded).toHaveBeenCalledWith(artifact);
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("surfaces a toast and does not call onUploaded when the upload fails", async () => {
    vi.spyOn(artifactsApi, "uploadFileArtifact").mockRejectedValue(new Error("boom"));
    const onUploaded = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<FileArtifactUpload companyId="c1" onUploaded={onUploaded} />);
    const file = new File(["x"], "deck.pdf", { type: "application/pdf" });
    await user.upload(screen.getByTestId("file-artifact-input"), file);
    expect(onUploaded).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledTimes(1);
  });
});
