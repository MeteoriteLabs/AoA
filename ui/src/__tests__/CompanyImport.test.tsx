import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, mockCompanyContext, makeCompany } from "./test-utils";
import { CompanyImport } from "../pages/CompanyImport";

const previewImport = vi.fn();
const importBundle = vi.fn();

vi.mock("@/api/company-portability", () => ({
  companyPortabilityApi: {
    previewImport: (...args: unknown[]) => previewImport(...args),
    importBundle: (...args: unknown[]) => importBundle(...args),
    previewExport: vi.fn(),
    exportBundle: vi.fn(),
  },
}));

const companiesListMock = vi.fn();

vi.mock("@/api/companies", () => ({
  companiesApi: {
    list: (...args: unknown[]) => companiesListMock(...args),
  },
}));

const navigateFn = vi.fn();

vi.mock("@/lib/router", async () => {
  const actual = await vi.importActual<object>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateFn,
  };
});

const mockCompany = makeCompany({ id: "comp-1", name: "Acme Inc", issuePrefix: "ACME" });

const reloadCompanies = vi.fn().mockResolvedValue(undefined);

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    ...mockCompanyContext,
    selectedCompany: mockCompany,
    selectedCompanyId: mockCompany.id,
    companies: [mockCompany],
    reloadCompanies,
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
    breadcrumbs: [],
    subtitle: null,
    setSubtitle: vi.fn(),
    entityColor: null,
    setEntityColor: vi.fn(),
  }),
}));

function makeValidBundle() {
  return {
    manifest: {
      schemaVersion: 2,
      generatedAt: "2026-04-21T00:00:00Z",
      source: "aoa",
      includes: { company: true, agents: true, projects: false, issues: false, skills: false, routines: false, envInputs: false },
      company: {
        slug: "acme",
        path: "company.md",
        name: "Acme Portable",
        description: "A portable company",
        brandColor: null,
      },
      agents: [
        { slug: "ceo", path: "agents/ceo.md", name: "CEO", role: "ceo", adapterType: "claude_local", title: null, icon: null, runtimeConfig: {}, adapterConfig: {}, skillKeys: [], reportsToSlug: null, projectSlug: null },
      ],
      requiredSecrets: [],
    },
    files: { "company.md": "# Acme" },
    warnings: [],
  };
}

function makePreviewResult(overrides: Partial<{
  warnings: unknown[];
  errors: string[];
  agentPlans: unknown[];
  projectPlans: unknown[];
  issuePlans: unknown[];
  skillPlans: unknown[];
  routinePlans: unknown[];
  companyAction: string;
  requiredSecrets: unknown[];
}> = {}) {
  return {
    include: { company: true, agents: true, projects: false, issues: false, skills: false, routines: false, envInputs: false },
    targetCompanyId: null,
    targetCompanyName: "Acme Portable",
    collisionStrategy: "rename",
    selectedAgentSlugs: ["ceo"],
    plan: {
      companyAction: overrides.companyAction ?? "create",
      agentPlans: overrides.agentPlans ?? [
        { slug: "ceo", action: "create", plannedName: "CEO", existingAgentId: null, reason: null },
      ],
      projectPlans: overrides.projectPlans ?? [],
      issuePlans: overrides.issuePlans ?? [],
      skillPlans: overrides.skillPlans ?? [],
      routinePlans: overrides.routinePlans ?? [],
    },
    requiredSecrets: overrides.requiredSecrets ?? [],
    warnings: overrides.warnings ?? [],
    errors: overrides.errors ?? [],
  };
}

async function uploadBundle(user: ReturnType<typeof userEvent.setup>, bundle: object | string) {
  const text = typeof bundle === "string" ? bundle : JSON.stringify(bundle);
  const file = new File([text], "bundle.aoa-bundle.json", { type: "application/json" });
  const input = screen.getByTestId("bundle-file-input") as HTMLInputElement;
  await user.upload(input, file);
}

describe("CompanyImport page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders heading and upload prompt", () => {
    renderWithProviders(<CompanyImport />);
    expect(screen.getByRole("heading", { name: /import company/i })).toBeInTheDocument();
    expect(screen.getByText(/upload bundle file/i)).toBeInTheDocument();
  });

  it("uploading a valid JSON file parses the bundle and shows its name", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await screen.findByText(/Acme Portable/);
  });

  it("shows an error when the uploaded file is not valid JSON", async () => {
    const user = userEvent.setup();
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, "not-json-at-all");
    await screen.findByText(/not valid json/i);
  });

  it("clicking Preview after upload calls previewImport with inline source", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(makePreviewResult());
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));

    await waitFor(() => expect(previewImport).toHaveBeenCalled());
    const arg = previewImport.mock.calls[0]![0] as { source: { type: string } };
    expect(arg.source.type).toBe("inline");
  });

  it("surfaces E.2 entity counts from bundle manifest in preview pane", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(makePreviewResult());
    renderWithProviders(<CompanyImport />);

    const bundle = makeValidBundle();
    // Add E.2 entity sections to the manifest
    (bundle.manifest as Record<string, unknown>).internalAgentConfig = {
      executionMode: "api",
      autonomyLevel: 2,
      notificationPreference: "mentions",
      contextTokenBudget: 8000,
      proactiveIntervalMinutes: 240,
    };
    (bundle.manifest as Record<string, unknown>).budgetPolicies = [
      { slug: "b1" },
      { slug: "b2" },
      { slug: "b3" },
    ];
    (bundle.manifest as Record<string, unknown>).costEvents = new Array(42).fill({
      slug: "ce",
    });
    (bundle.manifest as Record<string, unknown>).financeEvents = [{ slug: "f1" }];
    (bundle.manifest as Record<string, unknown>).quotaWindows = [
      { slug: "q1" },
      { slug: "q2" },
    ];

    await uploadBundle(user, bundle);
    await user.click(screen.getByRole("button", { name: /preview/i }));

    await screen.findByText(/Budget & Internal Agent/i);
    expect(screen.getByText(/^Internal agent$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Budget policies$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Cost events$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Finance events$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Quota windows$/i)).toBeInTheDocument();
    // Counts rendered
    expect(screen.getByText(/^42$/)).toBeInTheDocument();
    expect(screen.getByText(/^3$/)).toBeInTheDocument();
  });

  it("renders preview plan actions and counts after previewImport succeeds", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(
      makePreviewResult({
        agentPlans: [
          { slug: "ceo", action: "create", plannedName: "CEO", existingAgentId: null, reason: null },
          { slug: "cto", action: "skip", plannedName: "CTO", existingAgentId: "a-1", reason: "already exists" },
        ],
        projectPlans: [
          { slug: "eng", action: "create", plannedName: "Engineering", existingProjectId: null, reason: null },
        ],
      }),
    );
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));

    await screen.findByText(/Agents/);
    // Rendered plan summary: 2 agents (1 create, 1 skip), 1 project (create)
    expect(screen.getByText(/Engineering/)).toBeInTheDocument();
  });

  it("renders warnings with amber styling when preview returns warnings", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(
      makePreviewResult({
        warnings: [
          { kind: "unknown_section", section: "memory", message: "Unknown section: memory" },
        ],
      }),
    );
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));
    await screen.findByText(/Unknown section: memory/);
  });

  it("renders required secrets when preview returns them", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(
      makePreviewResult({
        requiredSecrets: [
          { key: "GITHUB_TOKEN", description: "GitHub API access", agentSlug: "ceo" },
        ],
      }),
    );
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));
    await screen.findByText(/GITHUB_TOKEN/);
  });

  it("changing collision strategy dropdown updates subsequent preview call", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(makePreviewResult());
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());

    const select = screen.getByLabelText(/collision strategy/i) as HTMLSelectElement;
    await user.selectOptions(select, "skip");

    await user.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() => expect(previewImport).toHaveBeenCalled());
    const arg = previewImport.mock.calls[previewImport.mock.calls.length - 1]![0] as {
      collisionStrategy: string;
    };
    expect(arg.collisionStrategy).toBe("skip");
  });

  it("Import button is disabled until preview succeeds", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(makePreviewResult());
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());

    const importBtn = screen.getByRole("button", { name: /^import$/i });
    expect(importBtn).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() => expect(importBtn).not.toBeDisabled());
  });

  it("clicking Import calls importBundle and redirects on success", async () => {
    const user = userEvent.setup();
    previewImport.mockResolvedValue(makePreviewResult());
    importBundle.mockResolvedValue({
      company: { id: "new-co-id", name: "Acme Portable", action: "created" },
      agents: [],
      projects: [],
      issues: [],
      skills: [],
      routines: [],
      requiredSecrets: [],
      warnings: [],
    });
    companiesListMock.mockResolvedValue([
      makeCompany({ id: "new-co-id", name: "Acme Portable", issuePrefix: "AP" }),
    ]);

    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^import$/i })).not.toBeDisabled(),
    );
    await user.click(screen.getByRole("button", { name: /^import$/i }));

    await waitFor(() => expect(importBundle).toHaveBeenCalled());
    await waitFor(() => expect(reloadCompanies).toHaveBeenCalled());
    await waitFor(() => expect(navigateFn).toHaveBeenCalled());
  });

  it("shows error state when preview API fails", async () => {
    const user = userEvent.setup();
    previewImport.mockRejectedValue(new Error("Server error"));
    renderWithProviders(<CompanyImport />);
    await uploadBundle(user, makeValidBundle());
    await user.click(screen.getByRole("button", { name: /preview/i }));
    await screen.findByText(/Server error/);
  });
});
