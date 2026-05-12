import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Secrets } from "./Secrets";
import { renderWithProviders } from "@/__tests__/test-utils";
import { secretsApi } from "@/api/secrets";

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", name: "Test Co" },
  }),
}));

vi.mock("@/context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({
    setBreadcrumbs: vi.fn(),
    setSubtitle: vi.fn(),
    setEntityColor: vi.fn(),
  }),
}));

vi.mock("@/lib/toast", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/api/secrets", () => ({
  secretsApi: {
    providers: vi.fn(),
    providerConfigs: {
      list: vi.fn(),
      create: vi.fn(),
      check: vi.fn(),
      remove: vi.fn(),
    },
    list: vi.fn(),
    create: vi.fn(),
    rotate: vi.fn(),
    remove: vi.fn(),
    bindings: {
      list: vi.fn(),
      create: vi.fn(),
      remove: vi.fn(),
    },
    accessEvents: vi.fn(),
    remoteImport: {
      preview: vi.fn(),
      commit: vi.fn(),
    },
  },
}));

const awsConfig = {
  id: "22222222-2222-2222-2222-222222222222",
  companyId: "company-1",
  provider: "aws_secrets_manager" as const,
  displayName: "Production AWS",
  status: "ready" as const,
  isDefault: true,
  config: { region: "us-east-1", secretNamePrefix: "aoa/prod" },
  healthStatus: "ready" as const,
  healthCheckedAt: new Date("2026-05-12T00:00:00Z"),
  healthMessage: null,
  healthDetails: null,
  disabledAt: null,
  createdByAgentId: null,
  createdByUserId: null,
  createdAt: new Date("2026-05-12T00:00:00Z"),
  updatedAt: new Date("2026-05-12T00:00:00Z"),
};

const secret = {
  id: "11111111-1111-1111-1111-111111111111",
  companyId: "company-1",
  name: "OpenAI API key",
  key: "OPENAI_API_KEY",
  status: "active" as const,
  managedMode: "external_reference" as const,
  provider: "aws_secrets_manager" as const,
  providerConfigId: awsConfig.id,
  providerMetadata: { redacted: "sk-live-secret" },
  externalRef: "arn:aws:secretsmanager:us-east-1:1:secret:aoa/prod/openai",
  latestVersion: 1,
  description: "Runtime LLM provider key",
  lastResolvedAt: new Date("2026-05-12T10:00:00Z"),
  lastRotatedAt: null,
  deletedAt: null,
  createdByAgentId: null,
  createdByUserId: null,
  createdAt: new Date("2026-05-12T00:00:00Z"),
  updatedAt: new Date("2026-05-12T00:00:00Z"),
  referenceCount: 1,
};

function mockBaseData() {
  vi.mocked(secretsApi.providers).mockResolvedValue([
    {
      id: "aws_secrets_manager",
      label: "AWS Secrets Manager",
      requiresExternalRef: false,
      supportsManagedValues: true,
      supportsExternalReferences: true,
      configured: true,
      status: "ready",
    },
    {
      id: "vault",
      label: "HashiCorp Vault",
      requiresExternalRef: true,
      supportsManagedValues: false,
      supportsExternalReferences: true,
      configured: false,
      status: "coming_soon",
    },
  ]);
  vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([awsConfig]);
  vi.mocked(secretsApi.list).mockResolvedValue([secret]);
  vi.mocked(secretsApi.bindings.list).mockResolvedValue([
    {
      id: "binding-1",
      companyId: "company-1",
      secretId: secret.id,
      targetType: "agent",
      targetId: "agent-1",
      configPath: "env.OPENAI_API_KEY",
      versionSelector: "latest",
      required: true,
      label: null,
      createdAt: new Date("2026-05-12T11:00:00Z"),
      updatedAt: new Date("2026-05-12T11:00:00Z"),
    },
  ]);
  vi.mocked(secretsApi.accessEvents).mockResolvedValue([
    {
      id: "event-1",
      companyId: "company-1",
      secretId: secret.id,
      version: 1,
      provider: "aws_secrets_manager",
      actorType: "system",
      actorId: "heartbeat",
      consumerType: "agent",
      consumerId: "agent-1",
      configPath: "env.OPENAI_API_KEY",
      issueId: null,
      heartbeatRunId: null,
      pluginId: null,
      outcome: "success",
      errorCode: null,
      createdAt: new Date("2026-05-12T12:00:00Z"),
    },
    {
      id: "event-2",
      companyId: "company-1",
      secretId: secret.id,
      version: null,
      provider: "aws_secrets_manager",
      actorType: "system",
      actorId: "heartbeat",
      consumerType: "agent",
      consumerId: "agent-1",
      configPath: "env.OPENAI_API_KEY",
      issueId: null,
      heartbeatRunId: null,
      pluginId: null,
      outcome: "failure",
      errorCode: "provider_error",
      createdAt: new Date("2026-05-12T12:05:00Z"),
    },
  ]);
}

describe("Secrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBaseData();
  });

  it("renders providers, inventory, bindings, and audit without secret material", async () => {
    renderWithProviders(<Secrets />);

    expect(await screen.findByRole("heading", { name: "Secrets" })).toBeTruthy();
    await screen.findAllByText("OpenAI API key");
    expect(screen.getAllByText("AWS Secrets Manager").length).toBeGreaterThan(0);
    expect(screen.getAllByText("OpenAI API key").length).toBeGreaterThan(0);
    expect((await screen.findAllByText("env.OPENAI_API_KEY")).length).toBeGreaterThan(0);
    expect(await screen.findByText("succeeded")).toBeTruthy();
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.queryByText("sk-live-secret")).toBeNull();
  });

  it("creates an AWS provider vault from the form", async () => {
    vi.mocked(secretsApi.providerConfigs.create).mockResolvedValue(awsConfig);

    renderWithProviders(<Secrets />);

    await screen.findByRole("heading", { name: "Provider Vaults" });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(secretsApi.providerConfigs.create).toHaveBeenCalledWith("company-1", {
        provider: "aws_secrets_manager",
        displayName: "Production AWS",
        isDefault: true,
        config: expect.objectContaining({
          region: "us-east-1",
          secretNamePrefix: "aoa/prod",
        }),
      });
    });
  });
});
