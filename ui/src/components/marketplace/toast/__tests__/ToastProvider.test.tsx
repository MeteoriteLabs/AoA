import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../ToastProvider";
import { InstallToastSlot } from "../InstallToastSlot";
import { useInstallToast } from "../useInstallToast";

function TestHarness() {
  const { show } = useInstallToast();
  return (
    <div>
      <button onClick={() => show({ status: "installing", message: "Installing Slack" })}>
        Show installing
      </button>
      <button onClick={() => show({ status: "success", message: "Installed Slack", actionLabel: "View", actionTo: "/marketplace" })}>
        Show success
      </button>
      <button onClick={() => show({ status: "failure", message: "Install failed", detail: "HTTP 500" })}>
        Show failure
      </button>
    </div>
  );
}

function wrap() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TestHarness />
        <InstallToastSlot />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Toast system", () => {
  it("shows installing toast with spinner", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Show installing" }));
    expect(screen.getByText("Installing Slack")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows success toast with action link", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Show success" }));
    expect(screen.getByText("Installed Slack")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /View/ })).toBeInTheDocument();
  });

  it("shows failure toast with detail", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Show failure" }));
    expect(screen.getByText("Install failed")).toBeInTheDocument();
    expect(screen.getByText("HTTP 500")).toBeInTheDocument();
  });

  it("dismisses on close button click", async () => {
    wrap();
    await userEvent.click(screen.getByRole("button", { name: "Show success" }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    expect(screen.queryByText("Installed Slack")).not.toBeInTheDocument();
  });

  it("useInstallToast returns no-op fallback when used outside provider", () => {
    function NoopConsumer() {
      const { show, update, dismiss, toast } = useInstallToast();
      // Calling the no-op methods should not throw
      const id = show({ status: "installing", message: "test" });
      update(id, { message: "updated" });
      dismiss();
      expect(toast).toBeNull();
      return null;
    }
    expect(() => render(<NoopConsumer />)).not.toThrow();
  });
});
