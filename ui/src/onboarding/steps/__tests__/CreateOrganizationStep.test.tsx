import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CreateOrganizationStep } from "../CreateOrganizationStep";
import { validateRegistry, type StepContext } from "../../registry";
import { ONBOARDING_STEPS } from "../index";

const createOrg = vi.fn(async (_: { name: string }) => ({ id: "org1", name: "Acme" }));
vi.mock("../../../api/organizations", () => ({ organizationsApi: { create: (a: any) => createOrg(a) } }));

const ctx: StepContext = {
  userId: "u1",
  journey: "founder",
  companyId: null,
  completedStates: ["AUTHENTICATED", "PROFILE_SET"],
  organizationId: null,
};

describe("CreateOrganizationStep", () => {
  it("requires an organization name", async () => {
    const onComplete = vi.fn();
    render(<CreateOrganizationStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText(/enter a name/i)).toBeTruthy();
    expect(createOrg).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("creates an organization, stores its id on ctx, and advances", async () => {
    const onComplete = vi.fn();
    const setOrganizationId = vi.fn();
    render(
      <CreateOrganizationStep
        ctx={{ ...ctx, setOrganizationId }}
        onComplete={onComplete}
        onBack={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => expect(createOrg).toHaveBeenCalledWith({ name: "Acme" }));
    await waitFor(() => expect(setOrganizationId).toHaveBeenCalledWith("org1"));
    await waitFor(() => expect(onComplete).toHaveBeenCalled());
  });

  it("surfaces a create failure and re-enables Continue", async () => {
    createOrg.mockRejectedValueOnce(new Error("network blew up"));
    const onComplete = vi.fn();
    render(<CreateOrganizationStep ctx={ctx} onComplete={onComplete} onBack={() => {}} />);
    fireEvent.change(screen.getByLabelText(/organization name/i), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(await screen.findByText("network blew up")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: /continue/i }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe("assembled registry registers the organization step before the company step", () => {
  it("ONBOARDING_STEPS still passes the registry guard", () => {
    expect(validateRegistry(ONBOARDING_STEPS)).toEqual([]);
  });
  it("registers CreateOrganizationStep (id 'organization') before the company step for the founder journey", () => {
    const org = ONBOARDING_STEPS.find((s) => s.id === "organization");
    const company = ONBOARDING_STEPS.find((s) => s.id === "company");
    expect(org).toBeTruthy();
    expect(company).toBeTruthy();
    expect(org?.Component).toBe(CreateOrganizationStep);
    expect(org?.journeys).toEqual(["founder"]);
    expect(org?.dependsOn).toEqual(["PROFILE_SET"]);
    expect(org!.order).toBeLessThan(company!.order);
  });
});
