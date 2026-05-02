import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { uploadMock } = vi.hoisted(() => ({
  uploadMock: vi.fn(async () => ({ asset: { id: "a-1", fileName: "x.pdf" }, jobId: "j-1" })),
}));

vi.mock("../api/memoryAssets", () => ({
  memoryAssetsApi: {
    upload: uploadMock,
    list: vi.fn(async () => []),
    contentUrl: () => "/test",
  },
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: vi.fn() }),
}));

import { MemoryUploadButton } from "../components/memory/MemoryUploadButton";

function renderButton(props?: Partial<React.ComponentProps<typeof MemoryUploadButton>>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryUploadButton
        companyId="co-1"
        departmentId="dept-1"
        folderPath="Engineering/Files"
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("MemoryUploadButton (Phase 6.1c)", () => {
  beforeEach(() => uploadMock.mockClear());

  it("renders an Upload button", () => {
    renderButton();
    expect(screen.getByRole("button", { name: /upload/i })).toBeInTheDocument();
  });

  it("calls upload on file selection", async () => {
    const user = userEvent.setup();
    renderButton();
    const file = new File(["hi"], "x.pdf", { type: "application/pdf" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    await user.upload(input, file);
    await waitFor(() =>
      expect(uploadMock).toHaveBeenCalledWith("co-1", file, {
        departmentId: "dept-1",
        folderPath: "Engineering/Files",
      }),
    );
  });
});
