import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompanySecret } from "@armyofagents/shared";
import { describe, expect, it, vi } from "vitest";
import { AddSecretDialog } from "@/components/secrets/AddSecretDialog";
import { RotateSecretDialog } from "@/components/secrets/RotateSecretDialog";

function makeSecret(partial: Partial<CompanySecret> = {}): CompanySecret {
  return {
    id: partial.id ?? "secret-1",
    companyId: "company-1",
    name: partial.name ?? "OpenAI API Key",
    key: partial.key ?? "OPENAI_API_KEY",
    status: partial.status ?? "active",
    managedMode: partial.managedMode ?? "aoa_managed",
    provider: partial.provider ?? "local_encrypted",
    providerConfigId: partial.providerConfigId ?? null,
    providerMetadata: partial.providerMetadata ?? null,
    externalRef: partial.externalRef ?? null,
    latestVersion: partial.latestVersion ?? 3,
    description: partial.description ?? "Used by QA",
    lastResolvedAt: partial.lastResolvedAt ?? null,
    lastRotatedAt: partial.lastRotatedAt ?? null,
    deletedAt: partial.deletedAt ?? null,
    createdByAgentId: partial.createdByAgentId ?? null,
    createdByUserId: partial.createdByUserId ?? null,
    createdAt: partial.createdAt ?? new Date("2026-05-14T00:00:00Z"),
    updatedAt: partial.updatedAt ?? new Date("2026-05-14T00:00:00Z"),
  };
}

describe("AddSecretDialog", () => {
  it("submits a local managed secret payload", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<AddSecretDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Name"), " OpenAI API Key ");
    await user.type(screen.getByLabelText("Key"), " OPENAI_API_KEY ");
    await user.type(screen.getByLabelText("Secret value"), "sk-live");
    await user.type(screen.getByLabelText("Description"), " Used by QA ");
    await user.click(screen.getByRole("button", { name: "Add secret" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "OpenAI API Key",
      key: "OPENAI_API_KEY",
      value: "sk-live",
      provider: "local_encrypted",
      providerConfigId: null,
      managedMode: "aoa_managed",
      description: "Used by QA",
      externalRef: null,
    });
  });

  it("warns when key looks sensitive", async () => {
    const user = userEvent.setup();

    render(<AddSecretDialog open onOpenChange={vi.fn()} onSubmit={vi.fn()} />);

    await user.type(screen.getByLabelText("Key"), "OPENAI_API_KEY");

    expect(screen.getByText(/this key name looks sensitive/i)).toBeInTheDocument();
  });

  it("does not require value in external reference mode and submits the external ref", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(<AddSecretDialog open onOpenChange={vi.fn()} onSubmit={onSubmit} />);

    await user.click(screen.getByRole("radio", { name: /external reference/i }));
    await user.type(screen.getByLabelText("Name"), " Stripe webhook ");
    await user.type(screen.getByLabelText("Key"), "STRIPE_WEBHOOK_SECRET");
    await user.type(
      screen.getByLabelText("External reference", { selector: "input" }),
      "arn:aws:secretsmanager:us-east-1:1:secret:stripe",
    );

    const value = screen.getByLabelText("Secret value");
    expect(value).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Add secret" }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: "Stripe webhook",
      key: "STRIPE_WEBHOOK_SECRET",
      value: null,
      provider: "local_encrypted",
      providerConfigId: null,
      managedMode: "external_reference",
      description: null,
      externalRef: "arn:aws:secretsmanager:us-east-1:1:secret:stripe",
    });
  });
});

describe("RotateSecretDialog", () => {
  it("shows version impact and submits a new value", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();

    render(
      <RotateSecretDialog
        open
        onOpenChange={vi.fn()}
        secret={makeSecret({ latestVersion: 3 })}
        impactedBindingCount={5}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Rotate secret" })).toBeInTheDocument();
    expect(screen.getByText("v3 latest")).toBeInTheDocument();
    expect(screen.getByText(/5 bindings/i)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: "Create v4" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("New value"), "sk-new");
    await waitFor(() => expect(submit).toBeEnabled());
    await user.click(submit);

    expect(onSubmit).toHaveBeenCalledWith({ value: "sk-new" });
  });
});
