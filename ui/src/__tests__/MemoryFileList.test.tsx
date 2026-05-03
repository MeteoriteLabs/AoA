import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/router");
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("../api/memory", () => ({
  memoryApi: {
    list: vi.fn(async () => [
      {
        id: "i-pinned",
        title: "Pinned item",
        category: "decision",
        status: "approved",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "engineering/Decisions",
        founderPinnedToTop: true,
      },
      {
        id: "i-pending",
        title: "Pending item",
        category: "reference",
        status: "pending",
        updatedAt: "2026-05-02T00:00:00Z",
        folderPath: "marketing/Brand",
        founderPinnedToTop: false,
      },
      {
        id: "i-other",
        title: "Other item",
        category: "context",
        status: "approved",
        updatedAt: "2026-04-29T00:00:00Z",
        folderPath: "engineering/Decisions",
        founderPinnedToTop: false,
      },
    ]),
  },
}));
vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: { list: vi.fn(async () => []) },
}));
vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "co-1",
    selectedCompany: { issuePrefix: "co1" },
  }),
}));

import { MemoryFileList } from "../components/memory/MemoryFileList";

function renderList(props: {
  folderPath: string;
  departmentId: string | null;
  layer?: string | null;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MemoryFileList
          companyId="co-1"
          folderPath={props.folderPath}
          departmentId={props.departmentId}
          layer={props.layer}
          selectedItemId={null}
          selectedItemType={null}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MemoryFileList — virtual folders (Phase 6.1e)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("__pinned shows only items with founderPinnedToTop=true", async () => {
    renderList({ folderPath: "__pinned", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Pinned item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Pending item")).not.toBeInTheDocument();
    expect(screen.queryByText("Other item")).not.toBeInTheDocument();
  });

  it("__pending shows only items with status=pending", async () => {
    renderList({ folderPath: "__pending", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Pending item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Pinned item")).not.toBeInTheDocument();
    expect(screen.queryByText("Other item")).not.toBeInTheDocument();
  });

  it("regular folder shows items with matching folderPath", async () => {
    renderList({
      folderPath: "engineering/Decisions",
      departmentId: "d-eng",
    });
    await waitFor(() =>
      expect(screen.getByText("Pinned item")).toBeInTheDocument(),
    );
    expect(screen.getByText("Other item")).toBeInTheDocument();
    expect(screen.queryByText("Pending item")).not.toBeInTheDocument();
  });
});

describe("MemoryFileList — category grouping (Phase 6.2a)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("groups items by category", async () => {
    renderList({
      folderPath: "engineering/Decisions",
      departmentId: "d-eng",
    });
    await waitFor(() =>
      expect(screen.getByText("Pinned item")).toBeInTheDocument(),
    );
    // The mock fixture has decision + context categories.
    // getAllByText used because the folder path "engineering/Decisions" also contains "Decisions"
    const decisionTexts = screen.getAllByText(/^Decisions$/i);
    expect(decisionTexts.length).toBeGreaterThan(0);
  });

  it("collapses group on header click", async () => {
    const user = userEvent.setup();
    renderList({
      folderPath: "engineering/Decisions",
      departmentId: "d-eng",
    });
    await waitFor(() => screen.getByText("Pinned item"));
    // Find the "Decisions" group header button
    const headerButtons = screen.getAllByRole("button", { expanded: true });
    // Click the first expanded group header to collapse it
    const decisionsHeader = headerButtons.find((b) =>
      /Decisions/i.test(b.textContent || ""),
    );
    expect(decisionsHeader).toBeDefined();
    await user.click(decisionsHeader!);
    expect(decisionsHeader!.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders ExpiresAtChip on active_context items with expiresAt", async () => {
    // The default fixture doesn't have expiresAt — re-mock with one
    const { memoryApi } = await import("../api/memory");
    (memoryApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "i-active",
        title: "Active item",
        category: "context",
        status: "approved",
        layer: "active_context",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "engineering/Decisions",
        founderPinnedToTop: false,
        expiresAt: "2026-05-08T12:00:00Z", // 5 days from NOW (2026-05-03)
      },
    ]);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-03T12:00:00Z"));
    renderList({
      folderPath: "engineering/Decisions",
      departmentId: "d-eng",
    });
    await waitFor(() => expect(screen.getByText("Active item")).toBeInTheDocument(), { timeout: 10000 });
    expect(screen.getByText(/expires in 5d/i)).toBeInTheDocument();
    vi.useRealTimers();
  });
});

describe("MemoryFileList — Phase 6.2a virtual folders + layer-only", () => {
  beforeEach(() => vi.clearAllMocks());

  it("__recent shows items updated in last 14 days, excludes archived", async () => {
    const { memoryApi } = await import("../api/memory");
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-05-03T00:00:00Z"));
    // recent = updated within 14 days of 2026-05-03 = after 2026-04-19
    // old = updated before 2026-04-19
    (memoryApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "i-recent",
        title: "Recent item",
        category: "decision",
        status: "approved",
        updatedAt: "2026-05-01T00:00:00Z", // 2 days ago — within 14d
        folderPath: "any",
        founderPinnedToTop: false,
      },
      {
        id: "i-archived",
        title: "Archived item",
        category: "decision",
        status: "archived",
        updatedAt: "2026-05-02T00:00:00Z", // within 14d but archived — must be excluded
        folderPath: "any",
        founderPinnedToTop: false,
      },
      {
        id: "i-old",
        title: "Old item",
        category: "context",
        status: "approved",
        updatedAt: "2026-03-01T00:00:00Z", // 63 days ago — outside 14d
        folderPath: "any",
        founderPinnedToTop: false,
      },
    ]);
    renderList({ folderPath: "__recent", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Recent item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Archived item")).not.toBeInTheDocument();
    expect(screen.queryByText("Old item")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it("__archived shows only items with status=archived", async () => {
    const { memoryApi } = await import("../api/memory");
    (memoryApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "i-archived",
        title: "Archived item",
        category: "decision",
        status: "archived",
        updatedAt: "2026-04-10T00:00:00Z",
        folderPath: "any",
        founderPinnedToTop: false,
      },
      {
        id: "i-approved",
        title: "Approved item",
        category: "reference",
        status: "approved",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "any",
        founderPinnedToTop: false,
      },
    ]);
    renderList({ folderPath: "__archived", departmentId: null });
    await waitFor(() =>
      expect(screen.getByText("Archived item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Approved item")).not.toBeInTheDocument();
  });

  it("layer-only URL (no folder, no dept) filters by layer", async () => {
    const { memoryApi } = await import("../api/memory");
    (memoryApi.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "i-domain",
        title: "Domain item",
        category: "reference",
        status: "approved",
        layer: "domain",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "",
        founderPinnedToTop: false,
      },
      {
        id: "i-identity",
        title: "Identity item",
        category: "decision",
        status: "approved",
        layer: "identity",
        updatedAt: "2026-05-01T00:00:00Z",
        folderPath: "",
        founderPinnedToTop: false,
      },
    ]);
    renderList({ folderPath: "", departmentId: null, layer: "domain" });
    await waitFor(() =>
      expect(screen.getByText("Domain item")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Identity item")).not.toBeInTheDocument();
  });
});
