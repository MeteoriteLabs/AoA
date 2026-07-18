import { validateRegistry, type StepDefinition } from "../registry";
import { HumanProfileStep } from "./HumanProfileStep";
import { OrgStep } from "./OrgStep";
import { EnvironmentStep } from "./EnvironmentStep";
import { CommanderStep } from "./CommanderStep";
import { VerifyStep } from "./VerifyStep";
import { SpineCompleteStep } from "./SpineCompleteStep";

/**
 * The real onboarding steps, assembled here (registry.ts stays pure logic).
 *
 * WS0c: the founder wizard is the SPINE ONLY — Profile → Company →
 * Environment → Commander → Verify → terminal (SETUP_COMPLETE). Department,
 * Agent, and Review are no longer wizard steps; the persona-driven In-flight
 * tail (department/agent/first-job) moves to Home's first-run experience
 * (WS4–8/WS9), doing its own domain writes rather than gated OnboardingState
 * advances. `DepartmentStep`/`AgentStep` components still exist (for later
 * Home reuse, extracted of their onboarding-advance calls) but are no longer
 * registered here; `ReviewStep` is fully replaced by `SpineCompleteStep`. See
 * docs/aoa/plans/2026-07-18-ws0c-onboarding-state-machine-design.md.
 */
export const ONBOARDING_STEPS: StepDefinition[] = [
  {
    id: "human-profile",
    order: 1,
    state: "PROFILE_SET",
    // Founders and invitees share the rich Human Operating Profile step; the
    // bare name-only ProfileStep it superseded was removed.
    journeys: ["founder", "invited"],
    dependsOn: ["AUTHENTICATED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("PROFILE_SET"),
    Component: HumanProfileStep,
    title: "Set up your profile",
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
  {
    id: "commander",
    order: 4,
    state: "COMMANDER_SELECTED",
    journeys: ["founder"],
    dependsOn: ["ENVIRONMENT_READY"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("COMMANDER_SELECTED"),
    Component: CommanderStep,
    title: "Choose Commander",
  },
  {
    id: "verify",
    order: 5,
    state: "COMMANDER_VERIFIED",
    journeys: ["founder"],
    dependsOn: ["COMMANDER_SELECTED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("COMMANDER_VERIFIED"),
    Component: VerifyStep,
    title: "Verify tooling",
  },
  {
    id: "spine-complete",
    order: 6,
    state: "SETUP_COMPLETE",
    journeys: ["founder"],
    dependsOn: ["COMMANDER_VERIFIED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("SETUP_COMPLETE"),
    Component: SpineCompleteStep,
    title: "Bringing you to your control room",
  },
];

export const ONBOARDING_REGISTRY_VALIDATION_ERRORS = validateRegistry(ONBOARDING_STEPS);
if (ONBOARDING_REGISTRY_VALIDATION_ERRORS.length > 0) {
  throw new Error(
    `Invalid onboarding registry: ${ONBOARDING_REGISTRY_VALIDATION_ERRORS.map((error) => error.message).join("; ")}`,
  );
}
