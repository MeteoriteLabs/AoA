// server/src/services/internal-agent/service-container.ts
import type { Db } from "@armyofagents/db";
import type { ServiceContainer } from "./types.js";
import { issueService } from "../issues.js";
import { goalService } from "../goals.js";
import { agentService } from "../agents.js";
import { projectService } from "../projects.js";
import { memoryService } from "../memory.js";
import { costService } from "../costs.js";
import { activityService } from "../activity.js";
import { heartbeatService } from "../heartbeat.js";
import { suggestionService } from "../suggestions.js";
import { artifactService } from "../artifacts.js";
import { dependencyService } from "../dependencies.js";
import { secretService } from "../secrets.js";
import { notificationService } from "../notifications.js";
import { discussionService } from "../discussions.js";

export function createServiceContainer(db: Db): ServiceContainer {
  return {
    issues: issueService(db),
    goals: goalService(db),
    agents: agentService(db),
    projects: projectService(db),
    memory: memoryService(db),
    costs: costService(db),
    activity: activityService(db),
    heartbeat: heartbeatService(db),
    suggestions: suggestionService(db),
    artifacts: artifactService(db),
    dependencies: dependencyService(db),
    secrets: secretService(db),
    notifications: notificationService(db),
    discussions: discussionService(db),
    workflows: null,
  };
}
