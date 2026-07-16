import { describe, it, expect, vi } from "vitest";
import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
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
        {/* "step-local-back", not "back": the engine chrome renders its own
            "Back" button — an ambiguous name would strict-mode-collide. */}
        <button data-testid={`back-${id}`} onClick={onBack}>step-local-back</button>
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

  it("renders the shared chrome: 'Step N of M' position chip + a central Back control", async () => {
    const api: FlowEngineApi = {
      getProgress: async () => ({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] }),
    };
    render(
      <FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={makeRegistry(() => {})} />,
    );

    await waitFor(() => screen.getByTestId("step-org"));
    expect(screen.getByTestId("onboarding-step-position").textContent).toBe("Step 2 of 2");

    // Central Back (rendered by the engine, not the step) walks to the
    // previous completed step; the chip follows.
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    await waitFor(() => screen.getByTestId("step-profile"));
    expect(screen.getByTestId("onboarding-step-position").textContent).toBe("Step 1 of 2");
  });

  it("central Back on the first step falls through to the onBack prop", async () => {
    const api: FlowEngineApi = { getProgress: async () => ({ completedStates: ["AUTHENTICATED"] }) };
    const onBack = vi.fn();
    render(
      <FlowEngine
        userId="u1"
        companyId={null}
        journey="founder"
        api={api}
        registry={makeRegistry(() => {})}
        onBack={onBack}
      />,
    );
    await waitFor(() => screen.getByTestId("step-profile"));
    fireEvent.click(screen.getByRole("button", { name: /^back$/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("ignores a stale user-layer reload after switching to the company layer", async () => {
    let staleComplete: (() => void) | undefined;
    let resolveCompany!: (progress: { completedStates: OnboardingState[] }) => void;
    let resolveStaleUser!: (progress: { completedStates: OnboardingState[] }) => void;
    let userLoads = 0;
    const companyProgress = new Promise<{ completedStates: OnboardingState[] }>((resolve) => {
      resolveCompany = resolve;
    });
    const staleUserProgress = new Promise<{ completedStates: OnboardingState[] }>((resolve) => {
      resolveStaleUser = resolve;
    });
    const api: FlowEngineApi = {
      getProgress: (companyId) => {
        if (companyId) return companyProgress;
        userLoads += 1;
        if (userLoads === 1) {
          return Promise.resolve({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] });
        }
        return staleUserProgress;
      },
    };
    const registry = makeRegistry(() => {});
    const OrgStep = ({ onComplete }: StepProps) => {
      staleComplete = onComplete;
      return <div data-testid="captured-org-step">org</div>;
    };
    registry[1] = { ...registry[1]!, Component: OrgStep };

    const { rerender } = render(
      <FlowEngine userId="u1" companyId={null} journey="founder" api={api} registry={registry} />,
    );
    await waitFor(() => screen.getByTestId("captured-org-step"));
    const completeFromUserLayer = staleComplete!;

    rerender(
      <FlowEngine userId="u1" companyId="c1" journey="founder" api={api} registry={registry} />,
    );
    act(() => completeFromUserLayer());

    await act(async () => {
      resolveCompany({
        completedStates: ["AUTHENTICATED", "PROFILE_SET", "ORGANIZATION_CREATED"],
      });
    });
    await waitFor(() => screen.getByTestId("onboarding-complete"));

    await act(async () => {
      resolveStaleUser({ completedStates: ["AUTHENTICATED", "PROFILE_SET"] });
    });
    expect(screen.queryByTestId("captured-org-step")).toBeNull();
    expect(screen.getByTestId("onboarding-complete")).toBeTruthy();
  });
});
