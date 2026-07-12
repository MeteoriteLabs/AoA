import type { StepDefinition } from "../registry";
import { ProfileStep } from "./ProfileStep";

/**
 * The real onboarding steps, assembled here (registry.ts stays pure logic).
 * More steps (org, environment, commander, department, agent, review) are
 * added as they land; the FlowEngine walks whatever is registered.
 */
export const ONBOARDING_STEPS: StepDefinition[] = [
  {
    id: "profile",
    order: 1,
    state: "PROFILE_SET",
    journeys: ["founder", "invited"],
    dependsOn: ["AUTHENTICATED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("PROFILE_SET"),
    Component: ProfileStep,
    title: "Your profile",
  },
];
