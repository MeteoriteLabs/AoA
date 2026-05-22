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
import { companyService } from "../companies.js";

export function createServiceContainer(db: Db): ServiceContainer {
  const companySvc = companyService(db);
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
    companies: {
      get: (id: string) => companySvc.getById(id).then((row) => {
        if (!row) return null;
        return {
          name: row.name ?? null,
          vision: row.vision ?? null,
          mission: row.mission ?? null,
          issuePrefix: row.issuePrefix ?? null,
          stage: null, // companies schema has no stage field
        };
      }),
      update: async (id: string, data: Partial<{ vision: string; mission: string }>) => {
        const row = await companySvc.update(id, data);
        if (!row) throw new Error(`Company ${id} not found`);
        return {
          id: row.id,
          name: row.name ?? null,
          vision: row.vision ?? null,
          mission: row.mission ?? null,
        };
      },
    },
    workflows: null,
  };
}
