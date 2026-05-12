import React, { type ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

// --- Mock company context ---
export const mockCompanyContext = {
  companies: [] as any[],
  selectedCompanyId: null as string | null,
  selectedCompany: null as any,
  selectionSource: "bootstrap" as const,
  loading: false,
  error: null,
  setSelectedCompanyId: vi.fn(),
  reloadCompanies: vi.fn().mockResolvedValue(undefined),
  createCompany: vi.fn().mockResolvedValue({}),
};

// --- Mock dialog context ---
export const mockDialogContext = {
  newIssueOpen: false,
  newIssueDefaults: {},
  openNewIssue: vi.fn(),
  closeNewIssue: vi.fn(),
  newProjectOpen: false,
  newProjectDefaults: {},
  openNewProject: vi.fn(),
  closeNewProject: vi.fn(),
  newGoalOpen: false,
  newGoalDefaults: {},
  openNewGoal: vi.fn(),
  closeNewGoal: vi.fn(),
  newAgentOpen: false,
  openNewAgent: vi.fn(),
  closeNewAgent: vi.fn(),
  onboardingOpen: false,
  onboardingOptions: {},
  openOnboarding: vi.fn(),
  closeOnboarding: vi.fn(),
  discussionCaptureOpen: false,
  discussionCaptureDefaults: {},
  openDiscussionCapture: vi.fn(),
  closeDiscussionCapture: vi.fn(),
};

// --- Mock breadcrumb context ---
export const mockBreadcrumbContext = {
  breadcrumbs: [],
  setBreadcrumbs: vi.fn(),
  subtitle: null,
  setSubtitle: vi.fn(),
  entityColor: null,
  setEntityColor: vi.fn(),
};

// --- Test wrapper ---
export function createWrapper(initialEntries: string[] = ["/"]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          {children}
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  {
    initialEntries = ["/"],
    ...renderOptions
  }: RenderOptions & { initialEntries?: string[] } = {},
) {
  const Wrapper = createWrapper(initialEntries);
  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

// --- Factory helpers ---
export function makeCompany(overrides: Record<string, any> = {}) {
  return {
    id: "comp-1",
    name: "Test Corp",
    issuePrefix: "TC",
    description: "A test company",
    brandColor: null,
    budgetMonthlyCents: 0,
    status: "active",
    requireBoardApprovalForNewAgents: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function makeAgent(overrides: Record<string, any> = {}) {
  return {
    id: "agent-1",
    name: "Claude Agent",
    role: "engineer",
    title: "Senior Engineer",
    status: "active",
    adapterType: "claude_local",
    icon: null,
    lastHeartbeatAt: new Date().toISOString(),
    companyId: "comp-1",
    projectId: null,
    runtimeConfig: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}
