import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
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

describe("Secrets render", () => {
  it("renders the page heading and AWS provider", async () => {
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
    ]);
    vi.mocked(secretsApi.providerConfigs.list).mockResolvedValue([]);
    vi.mocked(secretsApi.list).mockResolvedValue([]);

    renderWithProviders(<Secrets />);

    expect(await screen.findByRole("heading", { name: "Secrets" })).toBeTruthy();
    expect(await screen.findByText("AWS Secrets Manager")).toBeTruthy();
  });
});
