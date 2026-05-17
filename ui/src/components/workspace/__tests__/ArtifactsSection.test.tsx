import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  artifactsApiMock: { getByIssueId: vi.fn().mockResolvedValue(null) },
  outputDetectionApiMock: { listForIssue: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../../../api/artifacts", () => ({ artifactsApi: mocks.artifactsApiMock }));
vi.mock("../../../api/output-detection", () => ({ outputDetectionApi: mocks.outputDetectionApiMock }));

import { ArtifactsSection } from "../sections/ArtifactsSection";

function renderSection() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ArtifactsSection issueId="issue-1" />
    </QueryClientProvider>,
  );
}

describe("ArtifactsSection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artifactsApiMock.getByIssueId.mockResolvedValue(null);
    mocks.outputDetectionApiMock.listForIssue.mockResolvedValue([]);
  });

  it("uses a compact empty state when there are no artifacts or output candidates", async () => {
    renderSection();

    expect(await screen.findByTestId("artifacts-empty")).toHaveTextContent("No artifacts yet");
    expect(screen.queryByText("No artifacts linked")).not.toBeInTheDocument();
  });
});
