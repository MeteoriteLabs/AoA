import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DepartmentStep } from "../DepartmentStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";
import { DEPARTMENT_FUNCTION_TYPES } from "@armyofagents/shared";

const list = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const create = vi.hoisted(() => vi.fn(async () => ({ id: "d1" })));
const createWorkspace = vi.hoisted(() => vi.fn(async () => ({})));
const getCompany = vi.hoisted(() => vi.fn(async () => ({ id: "c1", rootFolder: "/home/ada/AoA" })));
const mkdir = vi.hoisted(() => vi.fn(async () => ({ created: true, path: "" })));

vi.mock("../../../api/projects", () => ({ projectsApi: { list, create, createWorkspace } }));
vi.mock("../../../api/companies", () => ({ companiesApi: { get: getCompany } }));
vi.mock("../../../api/filesystem", () => ({ filesystemApi: { mkdir } }));
vi.mock("../../../api/onboarding", () => ({
  advanceOnboarding: vi.fn(async () => ({ completedStates: [] })),
}));

import { advanceOnboarding } from "../../../api/onboarding";

const ctx: StepContext = {
  userId: "u1",
  companyId: "c1",
  journey: "founder",
  completedStates: [
    "AUTHENTICATED",
    "PROFILE_SET",
    "ORGANIZATION_CREATED",
    "ENVIRONMENT_READY",
    "COMMANDER_SELECTED",
    "COMMANDER_VERIFIED",
  ],
};

describe("DepartmentStep (Stage C / order 6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    list.mockResolvedValue([]);
    create.mockResolvedValue({ id: "d1" });
    getCompany.mockResolvedValue({ id: "c1", rootFolder: "/home/ada/AoA" });
  });

  it("creates a software department + nested workspace, advances DEPARTMENT_CREATED, completes", async () => {
    const onComplete = vi.fn();
    render(<DepartmentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Engineering"), { target: { value: "Engineering" } });
    // wait for the nested-folder prefill to settle
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/engineering")).toBeTruthy());
    fireEvent.click(screen.getByText("Create department"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ name: "Engineering", type: "department", functionType: "software_development" }),
    );
    expect(createWorkspace).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({ cwd: "/home/ada/AoA/engineering" }),
    );
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "DEPARTMENT_CREATED",
    });
  });

  it("is idempotent — reuses an existing same-named department (no second create)", async () => {
    list.mockResolvedValue([{ id: "existing", type: "department", name: "Engineering" }]);
    const onComplete = vi.fn();
    render(<DepartmentStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText("Engineering"), { target: { value: "Engineering" } });
    await waitFor(() => expect(screen.getByDisplayValue("/home/ada/AoA/engineering")).toBeTruthy());
    fireEvent.click(screen.getByText("Create department"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    expect(advanceOnboarding).toHaveBeenCalledWith({
      companyId: "c1",
      journey: "founder",
      requestedState: "DEPARTMENT_CREATED",
    });
  });

  it("prefills the name so the create button isn't silently disabled (live-QA regression)", () => {
    render(<DepartmentStep ctx={ctx} onComplete={vi.fn()} onBack={() => {}} />);
    const btn = screen.getByRole("button", { name: "Create department" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(screen.getByDisplayValue("Engineering")).toBeTruthy();
  });
});

describe("assembled registry includes the department step", () => {
  it("passes the guard and registers at order 6", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
    const d = ONBOARDING_STEPS.find((s) => s.state === "DEPARTMENT_CREATED");
    expect(d?.order).toBe(6);
    expect(d?.dependsOn).toEqual(["COMMANDER_VERIFIED"]);
  });
  it("uses the shared taxonomy (sales present)", () => {
    expect(DEPARTMENT_FUNCTION_TYPES.some((t) => t.value === "sales")).toBe(true);
  });
});
