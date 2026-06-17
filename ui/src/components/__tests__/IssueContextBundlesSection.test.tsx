import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../__tests__/test-utils";
import { IssueContextBundlesSection } from "../IssueContextBundlesSection";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: null }),
}));

describe("IssueContextBundlesSection", () => {
  it("renders discussion scope handoff artifact context with a source thread link", () => {
    renderWithProviders(
      <IssueContextBundlesSection
        bundles={[
          {
            id: "bundle-1",
            companyId: "company-1",
            sourceIssueId: "task-1",
            targetIssueId: "task-1",
            brief: "Discussion scope handoff",
            items: [
              {
                id: "item-1",
                itemType: "artifact",
                sourceId: "artifact-1",
                label: "scope-handoff.md",
                metadata: {
                  source: "discussion_scope",
                  discussionId: "discussion-1",
                },
              },
            ],
          },
        ]}
      />,
      { initialEntries: ["/EEA/issues?selected=EEA-2"] },
    );

    expect(screen.getByTestId("issue-context-bundles-section")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Scope handoff" })).toBeInTheDocument();
    expect(screen.getByText("scope-handoff.md")).toBeInTheDocument();
    expect(screen.getByText("artifact")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open source thread/i })).toHaveAttribute(
      "href",
      "/EEA/discussions/discussion-1",
    );
  });

  it("does not render when there are no context bundles", () => {
    renderWithProviders(<IssueContextBundlesSection bundles={[]} />);
    expect(screen.queryByTestId("issue-context-bundles-section")).not.toBeInTheDocument();
  });
});
