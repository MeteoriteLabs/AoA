import type { MutableTaskOutput, TaskOutput } from "@armyofagents/shared";
import { api } from "./client";

export const taskOutputsApi = {
  listForIssue: (issueId: string) =>
    api.get<TaskOutput[]>(`/issues/${issueId}/outputs`),
  update: (id: string, patch: MutableTaskOutput) =>
    api.patch<TaskOutput>(`/task-outputs/${id}`, patch),
};
