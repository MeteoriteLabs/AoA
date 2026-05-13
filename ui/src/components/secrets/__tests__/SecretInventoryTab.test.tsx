import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompanySecret } from "@armyofagents/shared";
import { describe, expect, it, vi } from "vitest";
import { SecretInventoryTab } from "@/components/secrets/SecretInventoryTab";

function makeSecret(partial: Partial<CompanySecret>): CompanySecret {
  return {
    id: partial.id ?? "secret-1",
    companyId: "company-1",
    name: partial.name ?? "OpenAI API Key",
    key: partial.key ?? "OPENAI_API_KEY",
    status: partial.status ?? "active",
    managedMode: partial.managedMode ?? "aoa_managed",
    provider: partial.provider ?? "local_encrypted",
    providerConfigId: null,
    providerMetadata: null,
    externalRef: partial.externalRef ?? null,
    latestVersion: partial.latestVersion ?? 1,
    description: partial.description ?? "Used by QA",
    lastResolvedAt: partial.lastResolvedAt ?? null,
    lastRotatedAt: null,
    deletedAt: null,
    createdByAgentId: null,
    createdByUserId: null,
    createdAt: new Date("2026-05-14T00:00:00Z"),
    updatedAt: new Date("2026-05-14T00:00:00Z"),
  };
}

describe("SecretInventoryTab", () => {
  it("filters secrets and selects one for detail", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const secrets = [
      makeSecret({ id: "openai", name: "OpenAI API Key", key: "OPENAI_API_KEY" }),
      makeSecret({
        id: "hubspot",
        name: "HubSpot Private App",
        key: "HUBSPOT_TOKEN",
        provider: "aws_secrets_manager",
      }),
    ];

    render(<SecretInventoryTab secrets={secrets} selectedSecret={secrets[0]} onSelectSecret={onSelect} />);

    expect(screen.getAllByText("OpenAI API Key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HubSpot Private App").length).toBeGreaterThan(0);

    await user.type(screen.getByPlaceholderText("Search by name, key, department"), "hub");
    expect(screen.queryByText("OpenAI API Key")).not.toBeInTheDocument();
    expect(screen.getAllByText("HubSpot Private App").length).toBeGreaterThan(0);

    await user.click(screen.getByText("HubSpot Private App"));
    expect(onSelect).toHaveBeenCalledWith("hubspot");
  });

  it("only shows action buttons when callbacks are provided", async () => {
    const user = userEvent.setup();
    const onRotate = vi.fn();
    const onArchive = vi.fn();
    const secret = makeSecret({ id: "hubspot", name: "HubSpot Private App", key: "HUBSPOT_TOKEN" });

    const { rerender } = render(
      <SecretInventoryTab secrets={[secret]} selectedSecret={secret} onSelectSecret={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();

    rerender(
      <SecretInventoryTab
        secrets={[secret]}
        selectedSecret={secret}
        onSelectSecret={vi.fn()}
        onRotate={onRotate}
        onArchive={onArchive}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Rotate" }));
    await user.click(screen.getByRole("button", { name: "Archive" }));

    expect(onRotate).toHaveBeenCalledWith(secret);
    expect(onArchive).toHaveBeenCalledWith(secret);
  });

  it("marks the selected row and shows an empty filtered state", async () => {
    const user = userEvent.setup();
    const secret = makeSecret({ id: "openai", name: "OpenAI API Key", key: "OPENAI_API_KEY" });

    render(<SecretInventoryTab secrets={[secret]} selectedSecret={secret} onSelectSecret={vi.fn()} />);

    expect(screen.getByRole("button", { name: /OpenAI API Key/i })).toHaveAttribute("aria-current", "true");

    await user.type(screen.getByPlaceholderText("Search by name, key, department"), "stripe");
    expect(screen.getByText("No secrets match your search")).toBeInTheDocument();
    expect(screen.queryByText("OpenAI API Key")).not.toBeInTheDocument();
  });
});
