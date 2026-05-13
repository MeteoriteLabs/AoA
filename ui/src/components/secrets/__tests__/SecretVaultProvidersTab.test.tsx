import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SecretVaultProvidersTab } from "../SecretVaultProvidersTab";

describe("SecretVaultProvidersTab", () => {
  it("shows local encrypted as default and opens AWS configure", async () => {
    render(<SecretVaultProvidersTab providerConfigs={[]} onCreateAwsVault={vi.fn()} onCheckVault={vi.fn()} />);

    expect(screen.getByText("Local encrypted")).toBeInTheDocument();
    expect(screen.getByText(/default vault/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /configure aws vault/i }));

    expect(screen.getByRole("dialog", { name: /aws secrets manager/i })).toBeInTheDocument();
  });
});
