import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FlowEngine, type FlowEngineApi } from "../FlowEngine";
import type { StepDefinition, StepProps } from "../registry";
import type { OnboardingState } from "@armyofagents/shared";

function testStep(id: string, state: OnboardingState, deps: OnboardingState[], order: number): StepDefinition {
  const Comp = ({ onComplete }: StepProps) => (
    <button data-testid={`step-${id}`} onClick={onComplete}>
      {id}
    </button>
  );
  return {
    id,
    order,
    state,
    journeys: ["founder"],
    dependsOn: deps,
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes(state),
    Component: Comp,
    title: id,
  };
}

const registry: StepDefinition[] = [
  testStep("profile", "PROFILE_SET", ["AUTHENTICATED"], 1),
  testStep("org", "ORGANIZATION_CREATED", ["PROFILE_SET"], 2),
];

describe("FlowEngine (Stage B / B6)", () => {
  it("renders the first step, advances on complete, then finishes", async () => {
    let completed: OnboardingState[] = ["AUTHENTICATED"];
    const api: FlowEngineApi = {
      getProgress: async () => ({ completedStates: completed }),
      advance: async ({ requestedState }) => {
        completed = [...completed, requestedState];
        return { completedStates: completed };
      },
    };
    const onFinished = vi.fn();
    render(
      <FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={registry} onFinished={onFinished} />,
    );

    await waitFor(() => screen.getByTestId("step-profile"));
    fireEvent.click(screen.getByTestId("step-profile"));

    await waitFor(() => screen.getByTestId("step-org"));
    fireEvent.click(screen.getByTestId("step-org"));

    await waitFor(() => screen.getByTestId("onboarding-complete"));
    expect(onFinished).toHaveBeenCalled();
  });

  it("resumes at the first incomplete step", async () => {
    const api: FlowEngineApi = {
      getProgress: async () => ({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] }),
      advance: async () => null,
    };
    render(<FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={registry} />);

    await waitFor(() => screen.getByTestId("step-org"));
    expect(screen.queryByTestId("step-profile")).toBeNull();
  });
});
