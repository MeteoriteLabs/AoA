// ui/src/components/skills/__tests__/SkillsHomeEmpty.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { CompanySkillListItem } from "@armyofagents/shared";
import { SkillsHomeEmpty } from "../SkillsHomeEmpty";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompany: { issuePrefix: "ACME" } }),
}));

function skill(id: string, name: string): CompanySkillListItem {
  return {
    id,
    companyId: "c1",
    key: `k-${id}`,
    slug: id,
    name,
    description: null,
    sourceType: "local_path",
    sourceLocator: null,
    sourceRef: null,
    trustLevel: "markdown_only",
    compatibility: "compatible",
    fileInventory: [{ path: "SKILL.md", kind: "skill" }],
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    attachedAgentCount: 0,
    editable: true,
    editableReason: null,
    sourceLabel: "Local",
    sourceBadge: "local",
    sourcePath: null,
  } as CompanySkillListItem;
}

const baseProps = {
  skills: [skill("a", "alpha"), skill("b", "beta")],
  recent: [
    { skillId: "a", openedAt: Date.now() - 1000 },
    { skillId: "missing", openedAt: Date.now() - 2000 }, // dropped from list
  ],
  onAddSkill: vi.fn(),
};

function renderHome(props: Partial<typeof baseProps> = {}) {
  return render(
    <MemoryRouter>
      <SkillsHomeEmpty {...baseProps} {...props} />
    </MemoryRouter>,
  );
}

describe("SkillsHomeEmpty", () => {
  it("renders the hero copy", () => {
    const { getByText } = renderHome();
    expect(getByText(/pick a skill/i)).toBeInTheDocument();
  });

  it("renders Add skill and Browse marketplace buttons", () => {
    const { getByRole } = renderHome();
    expect(getByRole("button", { name: /add skill/i })).toBeInTheDocument();
    expect(getByRole("link", { name: /browse marketplace/i })).toBeInTheDocument();
  });

  it("calls onAddSkill when Add skill is clicked", () => {
    const onAddSkill = vi.fn();
    const { getByRole } = renderHome({ onAddSkill });
    fireEvent.click(getByRole("button", { name: /add skill/i }));
    expect(onAddSkill).toHaveBeenCalled();
  });

  it("renders only resolvable recent skills (drops unknown ids)", () => {
    const { getByText, queryByText } = renderHome();
    expect(getByText("alpha")).toBeInTheDocument();
    expect(queryByText("missing")).toBeNull();
  });

  it("hides Recently opened section when there are no resolvable recents", () => {
    const { queryByText } = renderHome({ recent: [] });
    expect(queryByText(/recently opened/i)).toBeNull();
  });
});
