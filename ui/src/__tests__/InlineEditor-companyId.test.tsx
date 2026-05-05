import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineEditor } from "../components/InlineEditor";

// Capture props passed into MarkdownEditor so we can assert companyId forwarding.
const capturedProps: Record<string, unknown> = {};

vi.mock("../components/MarkdownEditor", () => ({
  MarkdownEditor: (props: Record<string, unknown>) => {
    Object.assign(capturedProps, props);
    return <div data-testid="markdown-editor-mock" />;
  },
}));

vi.mock("../components/MarkdownBody", () => ({
  MarkdownBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("InlineEditor companyId forwarding", () => {
  beforeEach(() => {
    for (const key of Object.keys(capturedProps)) delete capturedProps[key];
  });

  it("forwards companyId prop to MarkdownEditor in multiline edit mode", async () => {
    const user = userEvent.setup();
    render(
      <InlineEditor
        value=""
        onSave={() => {}}
        multiline
        companyId="comp-abc-123"
        placeholder="click me"
      />,
    );

    await user.click(screen.getByText("click me"));
    expect(capturedProps.companyId).toBe("comp-abc-123");
  });

  it("forwards null companyId when not provided", async () => {
    const user = userEvent.setup();
    render(<InlineEditor value="" onSave={() => {}} multiline placeholder="click me" />);

    await user.click(screen.getByText("click me"));
    expect(capturedProps.companyId).toBeUndefined();
  });
});
