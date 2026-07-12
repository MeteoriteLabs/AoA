import type { StepDefinition } from "../registry";
import { ProfileStep } from "./ProfileStep";
import { OrgStep } from "./OrgStep";
import { EnvironmentStep } from "./EnvironmentStep";

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
  {
    id: "organization",
    order: 2,
    state: "ORGANIZATION_CREATED",
    journeys: ["founder"],
    dependsOn: ["PROFILE_SET"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("ORGANIZATION_CREATED"),
    Component: OrgStep,
    title: "Create your organization",
  },
  {
    id: "environment",
    order: 3,
    state: "ENVIRONMENT_READY",
    journeys: ["founder"],
    dependsOn: ["ORGANIZATION_CREATED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("ENVIRONMENT_READY"),
    Component: EnvironmentStep,
    title: "Set up environment",
  },
];
