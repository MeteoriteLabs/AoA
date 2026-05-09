import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { MemoryCollapsedTabStrip } from "../MemoryCollapsedTabStrip";
import type { MemoryTab, TabKey } from "../../../lib/memoryTabs";

const tabs: MemoryTab[] = [
  { id: "a", kind: "memory_item", title: "README.md" },
  { id: "b", kind: "asset", title: "logo.png" },
];

const activeKey: TabKey = { id: "a", kind: "memory_item" };

const baseProps = {
  tabs,
  activeKey,
  onActivate: () => {},
  onExpand: () => {},
};

describe("MemoryCollapsedTabStrip", () => {
  it("renders an expand-pane button + one icon per open tab", () => {
    const { getByTitle, container } = render(<MemoryCollapsedTabStrip {...baseProps} />);
    expect(getByTitle("Expand pane")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-tab-id]")).toHaveLength(2);
  });

  it("marks the active tab with data-active and brand wash", () => {
    const { container } = render(<MemoryCollapsedTabStrip {...baseProps} />);
    const active = container.querySelector("[data-active='true']");
    expect(active?.getAttribute("data-tab-id")).toBe("a");
    expect(active?.getAttribute("data-tab-kind")).toBe("memory_item");
    expect(active?.className).toContain("bg-brand/[0.08]");
  });

  it("disambiguates active by both id AND kind", () => {
    const tabs2: MemoryTab[] = [
      { id: "x", kind: "memory_item", title: "Item X" },
      { id: "x", kind: "asset", title: "Asset X" },
    ];
    const { container } = render(
      <MemoryCollapsedTabStrip
        {...baseProps}
        tabs={tabs2}
        activeKey={{ id: "x", kind: "asset" }}
      />,
    );
    const actives = container.querySelectorAll("[data-active='true']");
    expect(actives.length).toBe(1);
    expect(actives[0].getAttribute("data-tab-kind")).toBe("asset");
  });

  it("calls onActivate(id, kind) when an icon is clicked", () => {
    const onActivate = vi.fn();
    const { container } = render(
      <MemoryCollapsedTabStrip {...baseProps} onActivate={onActivate} />,
    );
    const inactiveBtn = container.querySelector(
      "[data-tab-id='b'][data-tab-kind='asset']",
    ) as HTMLElement;
    fireEvent.click(inactiveBtn);
    expect(onActivate).toHaveBeenCalledWith("b", "asset");
  });

  it("calls onExpand when the expand-pane button is clicked", () => {
    const onExpand = vi.fn();
    const { getByTitle } = render(
      <MemoryCollapsedTabStrip {...baseProps} onExpand={onExpand} />,
    );
    fireEvent.click(getByTitle("Expand pane"));
    expect(onExpand).toHaveBeenCalled();
  });

  it("renders only the expand button when tabs is empty", () => {
    const { getByTitle, container } = render(
      <MemoryCollapsedTabStrip {...baseProps} tabs={[]} activeKey={null} />,
    );
    expect(getByTitle("Expand pane")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-tab-id]")).toHaveLength(0);
  });
});
