import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { FlowEngine, type FlowEngineApi } from "../FlowEngine";
import type { StepDefinition, StepProps } from "../registry";
import type { OnboardingState } from "@armyofagents/shared";

// Steps own their advance (mutating shared `completed` via a closure) then call
// onComplete; the engine re-reads via api.getProgress.
function makeRegistry(advance: (s: OnboardingState) => void): StepDefinition[] {
  const mk = (id: string, state: OnboardingState, deps: OnboardingState[], order: number): StepDefinition => {
    const Comp = ({ onComplete, onBack }: StepProps) => (
      <div>
        <button
          data-testid={`step-${id}`}
          onClick={() => {
            advance(state);
            onComplete();
          }}
        >
          {id}
        </button>
        <button data-testid={`back-${id}`} onClick={onBack}>back</button>
      </div>
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
  };
  return [
    mk("profile", "PROFILE_SET", ["AUTHENTICATED"], 1),
    mk("org", "ORGANIZATION_CREATED", ["PROFILE_SET"], 2),
  ];
}

describe("FlowEngine (Stage B / B6)", () => {
  it("renders the first step, advances on complete, then finishes", async () => {
    let completed: OnboardingState[] = ["AUTHENTICATED"];
    const advance = (s: OnboardingState) => {
      completed = [...completed, s];
    };
    const api: FlowEngineApi = { getProgress: async () => ({ completedStates: completed }) };
    const onFinished = vi.fn();
    render(
      <FlowEngine
        userId="u1"
        companyId={null}
        journey="founder"
        api={api}
        registry={makeRegistry(advance)}
        onFinished={onFinished}
      />,
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
    };
    render(
      <FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={makeRegistry(() => {})} />,
    );

    await waitFor(() => screen.getByTestId("step-org"));
    expect(screen.queryByTestId("step-profile")).toBeNull();
  });

  it("walks back to the previous completed step", async () => {
    const api: FlowEngineApi = {
      getProgress: async () => ({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] }),
    };
    render(
      <FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={makeRegistry(() => {})} />,
    );

    await waitFor(() => screen.getByTestId("step-org"));
    fireEvent.click(screen.getByTestId("back-org"));
    await waitFor(() => screen.getByTestId("step-profile"));
    fireEvent.click(screen.getByTestId("step-profile"));
    await waitFor(() => screen.getByTestId("step-org"));
  });
});
