import { validateRegistry, type StepDefinition } from "../registry";
import { HumanProfileStep } from "./HumanProfileStep";
import { OrgStep } from "./OrgStep";
import { EnvironmentStep } from "./EnvironmentStep";
import { CommanderStep } from "./CommanderStep";
import { VerifyStep } from "./VerifyStep";
import { DepartmentStep } from "./DepartmentStep";
import { AgentStep } from "./AgentStep";
import { ReviewStep } from "./ReviewStep";

/**
 * The real onboarding steps, assembled here (registry.ts stays pure logic).
 * More steps (org, environment, commander, department, agent, review) are
 * added as they land; the FlowEngine walks whatever is registered.
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
    id: "department",
    order: 6,
    state: "DEPARTMENT_CREATED",
    journeys: ["founder"],
    dependsOn: ["COMMANDER_VERIFIED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("DEPARTMENT_CREATED"),
    Component: DepartmentStep,
    title: "First department",
  },
  {
    id: "agent",
    order: 7,
    state: "AGENT_ASSIGNED",
    journeys: ["founder"],
    dependsOn: ["DEPARTMENT_CREATED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("AGENT_ASSIGNED"),
    Component: AgentStep,
    title: "First agent",
  },
  {
    id: "review",
    order: 8,
    state: "SETUP_COMPLETE",
    journeys: ["founder"],
    dependsOn: ["AGENT_ASSIGNED"],
    canSkip: false,
    shouldInclude: () => true,
    isComplete: (ctx) => ctx.completedStates.includes("SETUP_COMPLETE"),
    Component: ReviewStep,
    title: "Review",
  },
];

export const ONBOARDING_REGISTRY_VALIDATION_ERRORS = validateRegistry(ONBOARDING_STEPS);
if (ONBOARDING_REGISTRY_VALIDATION_ERRORS.length > 0) {
  throw new Error(
    `Invalid onboarding registry: ${ONBOARDING_REGISTRY_VALIDATION_ERRORS.map((error) => error.message).join("; ")}`,
  );
}
