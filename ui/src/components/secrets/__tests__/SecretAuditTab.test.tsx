import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SecretAccessEvent } from "@armyofagents/shared";
import { SecretAuditTab } from "../SecretAuditTab";

describe("SecretAuditTab", () => {
  it("opens readable audit detail", async () => {
    const events: SecretAccessEvent[] = [
      {
        id: "event-1",
        companyId: "company-1",
        secretId: "secret-1",
        version: 2,
        provider: "local_encrypted",
        actorType: "agent",
        actorId: "agent-1",
        consumerType: "agent",
        consumerId: "QA Agent",
        configPath: "env.OPENAI_API_KEY",
        issueId: "VQA-18",
        heartbeatRunId: "run-1",
        pluginId: null,
        outcome: "success",
        errorCode: null,
        createdAt: new Date("2026-05-14T12:00:00Z"),
      },
    ];

    render(<SecretAuditTab events={events} />);

    await userEvent.click(screen.getByText(/qa agent/i));

    expect(screen.getByRole("dialog", { name: /audit event/i })).toBeInTheDocument();
    expect(screen.getByText("env.OPENAI_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("VQA-18")).toBeInTheDocument();
  });
});
