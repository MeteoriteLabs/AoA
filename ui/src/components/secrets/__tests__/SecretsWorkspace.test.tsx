import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompanySecret } from "@armyofagents/shared";
import { describe, expect, it, vi } from "vitest";
import { SecretsWorkspace } from "@/components/secrets/SecretsWorkspace";
import { renderWithProviders } from "@/__tests__/test-utils";
import { secretsApi } from "@/api/secrets";
import {
  formatSecretDate,
  looksSensitiveKey,
  modeLabel,
  providerConfigSummary,
  providerLabel,
} from "@/components/secrets/secret-ui";

vi.mock("@/api/secrets", () => ({
  secretsApi: {
    list: vi.fn(),
    providers: vi.fn(),
    create: vi.fn(),
    rotate: vi.fn(),
    providerConfigs: {
      list: vi.fn(),
      create: vi.fn(),
      check: vi.fn(),
    },
    bindings: {
      list: vi.fn(),
    },
    accessEvents: vi.fn(),
  },
}));

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

describe("SecretsWorkspace", () => {
  it("renders the secrets settings shell", async () => {
    vi.mocked(secretsApi.list).mockResolvedValue([]);
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    expect(await screen.findByRole("heading", { name: "Secrets." })).toBeTruthy();
    expect(
      screen.getByText("Credentials and secret references used by agents, environments, departments, and integrations."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add secret" })).toBeTruthy();

    expect(screen.getByRole("tab", { name: "Inventory" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Bindings" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Vault providers" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Audit" })).toBeTruthy();
  });

  it("shows an error instead of the empty state when secrets fail to load", async () => {
    vi.mocked(secretsApi.list).mockRejectedValue(new Error("Network unavailable"));
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    expect(await screen.findByText("Failed to load secrets. Please refresh and try again.")).toBeTruthy();
    expect(screen.queryByText("No secrets yet")).toBeNull();
  });

  it("renders inventory for non-empty secrets and hides it on another tab", async () => {
    const user = userEvent.setup();
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.bindings.list).mockResolvedValue([]);
    vi.mocked(secretsApi.accessEvents).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValue([
      makeSecret({ id: "openai", name: "OpenAI API Key", key: "OPENAI_API_KEY" }),
      makeSecret({ id: "hubspot", name: "HubSpot Private App", key: "HUBSPOT_TOKEN" }),
    ]);

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    expect(await screen.findByPlaceholderText("Search by name, key, department")).toBeTruthy();
    expect(screen.getAllByText("OpenAI API Key").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HubSpot Private App").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Rotate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Archive" })).toBeNull();

    await user.click(screen.getByRole("tab", { name: "Bindings" }));

    expect(screen.queryByPlaceholderText("Search by name, key, department")).toBeNull();
    expect(await screen.findByText("No bindings for this secret")).toBeTruthy();
  });

  it("creates a local managed secret from the header dialog and selects it after success", async () => {
    const user = userEvent.setup();
    const created = makeSecret({ id: "stripe", name: "Stripe API Key", key: "STRIPE_API_KEY" });
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.accessEvents).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValueOnce([]).mockResolvedValue([created]);
    vi.mocked(secretsApi.create).mockResolvedValue(created);

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    await user.click(await screen.findByRole("button", { name: "Add secret" }));
    const dialog = screen.getByRole("dialog", { name: "Add secret" });
    await user.type(within(dialog).getByLabelText("Name"), " Stripe API Key ");
    await user.type(within(dialog).getByLabelText("Key"), " STRIPE_API_KEY ");
    await user.type(within(dialog).getByLabelText("Secret value"), "sk-live");
    await user.click(within(dialog).getByRole("button", { name: "Add secret" }));

    expect(secretsApi.create).toHaveBeenCalledWith("company-1", {
      name: "Stripe API Key",
      key: "STRIPE_API_KEY",
      value: "sk-live",
      provider: "local_encrypted",
      providerConfigId: null,
      managedMode: "aoa_managed",
      description: null,
      externalRef: null,
    });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add secret" })).not.toBeInTheDocument());
    expect((await screen.findAllByText("Stripe API Key")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /Stripe API Key/i })).toHaveAttribute("aria-current", "true");
  });

  it("keeps add dialog open and shows create failures", async () => {
    const user = userEvent.setup();
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.accessEvents).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValue([]);
    vi.mocked(secretsApi.create).mockRejectedValue(new Error("Create failed"));

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    await user.click(await screen.findByRole("button", { name: "Add secret" }));
    const dialog = screen.getByRole("dialog", { name: "Add secret" });
    await user.type(within(dialog).getByLabelText("Name"), "Stripe API Key");
    await user.type(within(dialog).getByLabelText("Secret value"), "sk-live");
    await user.click(within(dialog).getByRole("button", { name: "Add secret" }));

    expect(await within(dialog).findByText("Create failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Add secret" })).toBeInTheDocument();
  });

  it("rotates an AoA-managed inventory secret and closes the dialog after success", async () => {
    const user = userEvent.setup();
    const secret = makeSecret({ id: "openai", name: "OpenAI API Key", key: "OPENAI_API_KEY", latestVersion: 3 });
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValue([secret]);
    vi.mocked(secretsApi.bindings.list).mockResolvedValue([]);
    vi.mocked(secretsApi.accessEvents).mockResolvedValue([]);
    vi.mocked(secretsApi.rotate).mockResolvedValue(makeSecret({ ...secret, latestVersion: 4 }));

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    const dialog = screen.getByRole("dialog", { name: "Rotate secret" });
    await user.type(within(dialog).getByLabelText("New value"), "sk-new");
    await user.click(within(dialog).getByRole("button", { name: "Create v4" }));

    expect(secretsApi.rotate).toHaveBeenCalledWith("openai", { value: "sk-new" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Rotate secret" })).not.toBeInTheDocument());
  });

  it("keeps rotate dialog open and shows rotate failures", async () => {
    const user = userEvent.setup();
    const secret = makeSecret({ id: "openai", name: "OpenAI API Key", key: "OPENAI_API_KEY", latestVersion: 3 });
    vi.mocked(secretsApi.providers).mockResolvedValue([]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValue([secret]);
    vi.mocked(secretsApi.bindings.list).mockResolvedValue([]);
    vi.mocked(secretsApi.accessEvents).mockResolvedValue([]);
    vi.mocked(secretsApi.rotate).mockRejectedValue(new Error("Rotate failed"));

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    await user.click(await screen.findByRole("button", { name: "Rotate" }));
    const dialog = screen.getByRole("dialog", { name: "Rotate secret" });
    await user.type(within(dialog).getByLabelText("New value"), "sk-new");
    await user.click(within(dialog).getByRole("button", { name: "Create v4" }));

    expect(await within(dialog).findByText("Rotate failed")).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Rotate secret" })).toBeInTheDocument();
  });
});

describe("secret-ui helpers", () => {
  it("formats provider and mode labels", () => {
    expect(providerLabel("aws_secrets_manager")).toBe("AWS Secrets Manager");
    expect(providerLabel("gcp_secret_manager")).toBe("GCP Secret Manager");
    expect(providerLabel("vault")).toBe("HashiCorp Vault");
    expect(providerLabel("local_encrypted")).toBe("Local encrypted");

    expect(modeLabel("aoa_managed")).toBe("AoA managed");
    expect(modeLabel("external_reference")).toBe("External reference");
  });

  it("summarizes provider config and sensitive keys", () => {
    expect(
      providerConfigSummary({
        id: "provider-config-1",
        companyId: "company-1",
        provider: "aws_secrets_manager",
        displayName: "Production AWS",
        status: "ready",
        isDefault: true,
        config: { region: "us-east-1", secretNamePrefix: "aoa/prod" },
        healthStatus: null,
        healthCheckedAt: null,
        healthMessage: null,
        healthDetails: null,
        disabledAt: null,
        createdByAgentId: null,
        createdByUserId: null,
        createdAt: new Date("2026-05-01T12:00:00Z"),
        updatedAt: new Date("2026-05-01T12:00:00Z"),
      }),
    ).toBe("us-east-1 / aoa/prod");

    expect(formatSecretDate(null)).toBe("Never");
    expect(looksSensitiveKey("OPENAI_API_KEY")).toBe(true);
    expect(looksSensitiveKey("PUBLIC_BASE_URL")).toBe(false);
  });
});
