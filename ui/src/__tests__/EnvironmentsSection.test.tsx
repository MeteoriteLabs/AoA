import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EnvironmentsSection } from "../components/settings/sections/EnvironmentsSection";
import type { Environment } from "@armyofagents/shared";

// ─── API hook mocks ──────────────────────────────────────────────────────────

const mockMutate = vi.fn();

const useEnvironmentsMock = vi.fn();
const useCreateEnvironmentMock = vi.fn();
const useUpdateEnvironmentMock = vi.fn();
const useDeleteEnvironmentMock = vi.fn();

vi.mock("@/api/environments", () => ({
  useEnvironments: (...args: unknown[]) => useEnvironmentsMock(...args),
  useCreateEnvironment: (...args: unknown[]) => useCreateEnvironmentMock(...args),
  useUpdateEnvironment: (...args: unknown[]) => useUpdateEnvironmentMock(...args),
  useDeleteEnvironment: (...args: unknown[]) => useDeleteEnvironmentMock(...args),
}));

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: "env-1",
    companyId: "comp-1",
    name: "production",
    envVars: { NODE_ENV: "production", PORT: "3000" },
    connectionTarget: null,
    createdAt: "2026-01-15T10:00:00Z",
    updatedAt: "2026-01-15T10:00:00Z",
    ...overrides,
  };
}

// Default mutation stub — idle, no errors
function idleMutation() {
  return {
    mutate: mockMutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    reset: vi.fn(),
  };
}

// ─── Render helper ───────────────────────────────────────────────────────────

function renderSection(companyId = "comp-1") {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={qc}>
      <EnvironmentsSection companyId={companyId} />
    </QueryClientProvider>,
  );
}

// ─── Setup ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Safe defaults — a loaded empty list with idle mutations
  useEnvironmentsMock.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
  });
  useCreateEnvironmentMock.mockReturnValue(idleMutation());
  useUpdateEnvironmentMock.mockReturnValue(idleMutation());
  useDeleteEnvironmentMock.mockReturnValue(idleMutation());
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("EnvironmentsSection", () => {
  it("shows loading skeletons while fetching", () => {
    useEnvironmentsMock.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderSection();

    // RowSkeleton renders elements with data-slot="skeleton" (Skeleton component)
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("shows empty state when no environments exist", () => {
    useEnvironmentsMock.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });

    renderSection();

    expect(screen.getByText("No environments yet")).toBeInTheDocument();
    expect(
      screen.getByText("Create your first environment"),
    ).toBeInTheDocument();
  });

  it("renders environment list rows with name and var count", () => {
    const env1 = makeEnvironment({
      id: "env-1",
      name: "production",
      envVars: { NODE_ENV: "production", PORT: "3000" },
    });
    const env2 = makeEnvironment({
      id: "env-2",
      name: "staging",
      envVars: { NODE_ENV: "staging" },
    });

    useEnvironmentsMock.mockReturnValue({
      data: [env1, env2],
      isLoading: false,
      isError: false,
    });

    renderSection();

    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
    // env1 has 2 vars, env2 has 1 var
    expect(screen.getByText(/2 variables/)).toBeInTheDocument();
    expect(screen.getByText(/1 variable[^s]/)).toBeInTheDocument();
  });

  it("opens Create dialog when New Environment button clicked", async () => {
    const user = userEvent.setup();

    renderSection();

    // The empty state "Create your first environment" button also opens the dialog,
    // but there's also a "New Environment" header button — use the header one.
    const newBtn = screen.getByRole("button", { name: /new environment/i });
    await user.click(newBtn);

    // Dialog title should appear
    expect(
      screen.getByRole("heading", { name: /new environment/i }),
    ).toBeInTheDocument();
  });

  it("submits create form with name and env vars", async () => {
    const user = userEvent.setup();
    const captureMutate = vi.fn((_vars: unknown, opts: Record<string, unknown>) => {
      (opts?.onSuccess as (data: unknown, vars: unknown, ctx: unknown) => void)?.(
        makeEnvironment(),
        _vars,
        undefined,
      );
    });

    // Simulate mutate calling onSuccess
    useCreateEnvironmentMock.mockReturnValue({
      ...idleMutation(),
      mutate: captureMutate,
    });

    renderSection();

    // Open create dialog
    await user.click(screen.getByRole("button", { name: /new environment/i }));

    // Fill in name
    const nameInput = screen.getByPlaceholderText(/e\.g\. production/i);
    await user.clear(nameInput);
    await user.type(nameInput, "testing");

    // Fill in env vars JSON — use fireEvent.change to avoid userEvent keyboard
    // escaping issues with braces/quotes inside JSON strings
    const textarea = screen.getByPlaceholderText(/\{"KEY": "value"\}/i);
    fireEvent.change(textarea, { target: { value: '{"TEST_KEY": "hello"}' } });

    // Submit
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      expect(captureMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          companyId: "comp-1",
          input: expect.objectContaining({
            name: "testing",
            envVars: expect.objectContaining({ TEST_KEY: "hello" }),
          }),
        }),
        expect.any(Object),
      );
    });
  });

  it("opens Edit dialog pre-filled with existing environment data", async () => {
    const user = userEvent.setup();
    const env = makeEnvironment({
      id: "env-1",
      name: "production",
      envVars: { NODE_ENV: "production" },
    });

    useEnvironmentsMock.mockReturnValue({
      data: [env],
      isLoading: false,
      isError: false,
    });

    renderSection();

    // Click the edit button for the environment
    const editBtn = screen.getByTitle("Edit environment");
    await user.click(editBtn);

    // Dialog should open in edit mode
    expect(
      screen.getByRole("heading", { name: /edit environment/i }),
    ).toBeInTheDocument();

    // Name field should be pre-filled
    const nameInput = screen.getByPlaceholderText(/e\.g\. production/i);
    expect((nameInput as HTMLInputElement).value).toBe("production");

    // Env vars textarea should contain the JSON
    const textarea = screen.getByPlaceholderText(/\{"KEY": "value"\}/i);
    expect((textarea as HTMLTextAreaElement).value).toContain("NODE_ENV");
  });

  it("shows delete confirmation dialog when trash icon clicked", async () => {
    const user = userEvent.setup();
    const env = makeEnvironment({ id: "env-1", name: "staging" });

    useEnvironmentsMock.mockReturnValue({
      data: [env],
      isLoading: false,
      isError: false,
    });

    renderSection();

    const deleteBtn = screen.getByTitle("Delete environment");
    await user.click(deleteBtn);

    // Alert dialog should appear
    expect(
      screen.getByRole("heading", { name: /delete environment\?/i }),
    ).toBeInTheDocument();
    // The env name appears both in the row and in the dialog description (in a <strong>)
    const mentions = screen.getAllByText("staging");
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByRole("button", { name: /^delete$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /cancel/i }),
    ).toBeInTheDocument();
  });

  it("calls deleteEnvironment mutation when confirm delete clicked", async () => {
    const user = userEvent.setup();
    const env = makeEnvironment({ id: "env-99", name: "old-env" });
    const deleteMutate = vi.fn();

    useEnvironmentsMock.mockReturnValue({
      data: [env],
      isLoading: false,
      isError: false,
    });
    useDeleteEnvironmentMock.mockReturnValue({
      ...idleMutation(),
      mutate: deleteMutate,
    });

    renderSection();

    await user.click(screen.getByTitle("Delete environment"));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(deleteMutate).toHaveBeenCalledWith(
        { companyId: "comp-1", id: "env-99" },
        expect.any(Object),
      );
    });
  });

  it("shows error state when fetching environments fails", () => {
    useEnvironmentsMock.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
    });

    renderSection();

    expect(
      screen.getByText(/failed to load environments/i),
    ).toBeInTheDocument();
  });

  it("renders section header with title and New Environment button", () => {
    renderSection();

    expect(
      screen.getByRole("heading", { name: /environments/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /new environment/i }),
    ).toBeInTheDocument();
  });

  it("shows singular 'variable' for env with exactly 1 var", () => {
    useEnvironmentsMock.mockReturnValue({
      data: [makeEnvironment({ envVars: { ONLY_ONE: "value" } })],
      isLoading: false,
      isError: false,
    });

    renderSection();

    expect(screen.getByText(/1 variable[^s]/)).toBeInTheDocument();
    expect(screen.queryByText(/1 variables/)).not.toBeInTheDocument();
  });

  it("shows 'No variables' for env with empty envVars", () => {
    useEnvironmentsMock.mockReturnValue({
      data: [makeEnvironment({ envVars: {} })],
      isLoading: false,
      isError: false,
    });

    renderSection();

    expect(screen.getByText(/No variables/)).toBeInTheDocument();
  });
});
