import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { FolderTreeNode } from "../FolderTreeNode";

describe("FolderTreeNode active state", () => {
  it("applies brand wash classes when selected", () => {
    const { container } = render(
      <FolderTreeNode
        label="Identity"
        depth={0}
        expanded={false}
        selected={true}
        hasChildren={false}
        onToggleExpand={() => {}}
        onSelect={() => {}}
      />,
    );
    const row = container.querySelector('[role="treeitem"]');
    expect(row?.className).toContain("bg-brand/[0.08]");
    expect(row?.className).toContain("text-[hsl(15_60%_75%)]");
  });

  it("renders the brand glow dot when selected", () => {
    const { container } = render(
      <FolderTreeNode
        label="Identity"
        depth={0}
        expanded={false}
        selected={true}
        hasChildren={false}
        onToggleExpand={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector(".bg-brand.rounded-full")).toBeInTheDocument();
  });

  it("hides the glow dot when not selected", () => {
    const { container } = render(
      <FolderTreeNode
        label="Identity"
        depth={0}
        expanded={false}
        selected={false}
        hasChildren={false}
        onToggleExpand={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(container.querySelector(".bg-brand.rounded-full")).toBeNull();
  });
});
