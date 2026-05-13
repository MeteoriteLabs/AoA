import { screen } from "@testing-library/react";
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
  },
}));

describe("SecretsWorkspace", () => {
  it("renders the secrets settings shell", async () => {
    vi.mocked(secretsApi.list).mockResolvedValue([]);

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

    renderWithProviders(<SecretsWorkspace companyId="company-1" />);

    expect(await screen.findByText("Failed to load secrets. Please refresh and try again.")).toBeTruthy();
    expect(screen.queryByText("No secrets yet")).toBeNull();
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
