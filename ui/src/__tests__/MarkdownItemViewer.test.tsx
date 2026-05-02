// ui/src/__tests__/MarkdownItemViewer.test.tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Stub @uiw/react-md-editor for jsdom — the real editor uses ESM-only code that
// won't run in jsdom; a simple textarea stub is sufficient for interaction tests.
vi.mock("@uiw/react-md-editor", () => ({
  default: ({ value, onChange }: any) => (
    <textarea
      data-testid="md-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// Use vi.hoisted so updateMock is defined before the factory is executed
const mocks = vi.hoisted(() => ({
  updateMock: vi.fn(async () => ({})),
  getMock: vi.fn(async () => ({
    id: "i-1",
    title: "Auth strategy",
    content: "# Hi\n\nReal content here.",
    status: "approved",
    category: "decision",
    layer: "domain",
    pinnedToSkill: false,
  })),
}));

vi.mock("../api/memory", () => ({
  memoryApi: {
    get: mocks.getMock,
    update: mocks.updateMock,
    approve: vi.fn(),
    reject: vi.fn(),
  },
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

import { MarkdownItemViewer } from "../components/memory/viewers/MarkdownItemViewer";

function renderViewer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MarkdownItemViewer companyId="co-1" itemId="i-1" />
    </QueryClientProvider>,
  );
}

describe("MarkdownItemViewer (Phase 6.1b)", () => {
  beforeEach(() => mocks.updateMock.mockClear());

  it("approved items default to preview mode", async () => {
    renderViewer();
    await waitFor(() => expect(screen.getByText("Auth strategy")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /edit/i })).toBeInTheDocument();
  });

  it("clicking Edit toggles to editor mode", async () => {
    const user = userEvent.setup();
    renderViewer();
    await waitFor(() => expect(screen.getByText("Auth strategy")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /edit/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^save$/i })).toBeInTheDocument(),
    );
  });
});
