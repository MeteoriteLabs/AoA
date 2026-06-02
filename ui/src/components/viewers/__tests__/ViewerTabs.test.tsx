import { fireEvent, render } from "@testing-library/react";
import { FileText } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { ViewerTabs, type ViewerTabModel } from "../ViewerTabs";

const tabs: ViewerTabModel[] = [
  { id: "one", kind: "memory_item", title: "Brand voice", icon: FileText },
  { id: "two", kind: "asset", title: "logo.png", icon: FileText },
];

describe("ViewerTabs", () => {
  it("marks the active tab and exposes tab metadata", () => {
    const { container } = render(
      <ViewerTabs
        tabs={tabs}
        activeKey={{ id: "one", kind: "memory_item" }}
        onActivate={() => {}}
      />,
    );

    const activeTab = container.querySelector("[data-active='true']");
    expect(activeTab).toHaveAttribute("data-tab-id", "one");
    expect(activeTab).toHaveAttribute("data-tab-kind", "memory_item");
    expect(activeTab).toHaveAttribute("aria-selected", "true");
  });

  it("calls onActivate with the selected tab", () => {
    const onActivate = vi.fn();
    const { getByText } = render(
      <ViewerTabs
        tabs={tabs}
        activeKey={{ id: "one", kind: "memory_item" }}
        onActivate={onActivate}
      />,
    );

    fireEvent.click(getByText("logo.png"));

    expect(onActivate).toHaveBeenCalledWith(tabs[1]);
  });

  it("calls onClose without activating the tab", () => {
    const onActivate = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <ViewerTabs
        tabs={tabs}
        activeKey={{ id: "one", kind: "memory_item" }}
        onActivate={onActivate}
        onClose={onClose}
      />,
    );

    const closeButton = container.querySelector(
      "[data-tab-id='two'][data-tab-kind='asset'] [data-slot='close']",
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();

    fireEvent.click(closeButton!);

    expect(onClose).toHaveBeenCalledWith(tabs[1]);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("renders add and collapse buttons when handlers are provided", () => {
    const onAdd = vi.fn();
    const onToggleCollapse = vi.fn();
    const { getByRole } = render(
      <ViewerTabs
        tabs={[]}
        activeKey={null}
        onActivate={() => {}}
        onAdd={onAdd}
        onToggleCollapse={onToggleCollapse}
      />,
    );

    fireEvent.click(getByRole("button", { name: "New viewer tab" }));
    fireEvent.click(getByRole("button", { name: "Close viewer" }));

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onToggleCollapse).toHaveBeenCalledTimes(1);
  });
});
