import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders, makeCompany } from "./test-utils";
import { InstanceAccessPage } from "../pages/InstanceAccessPage";
import { ApiError } from "../api/client";

const mockSearchAdminUsers = vi.fn();
const mockGetUserCompanyAccess = vi.fn();
const mockSetUserCompanyAccess = vi.fn();
const mockPromoteInstanceAdmin = vi.fn();
const mockDemoteInstanceAdmin = vi.fn();

vi.mock("../api/access", () => ({
  accessApi: {
    searchAdminUsers: (...args: unknown[]) => mockSearchAdminUsers(...args),
    getUserCompanyAccess: (...args: unknown[]) => mockGetUserCompanyAccess(...args),
    setUserCompanyAccess: (...args: unknown[]) => mockSetUserCompanyAccess(...args),
    promoteInstanceAdmin: (...args: unknown[]) => mockPromoteInstanceAdmin(...args),
    demoteInstanceAdmin: (...args: unknown[]) => mockDemoteInstanceAdmin(...args),
  },
}));

const mockPushToast = vi.fn();

vi.mock("../context/ToastContext", () => ({
  useToast: () => ({ pushToast: mockPushToast }),
}));

const company1 = makeCompany({ id: "comp-1", name: "Acme", issuePrefix: "ACM" });
const company2 = makeCompany({ id: "comp-2", name: "Globex", issuePrefix: "GBX" });

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    companies: [company1, company2],
    selectedCompanyId: "comp-1",
    selectedCompany: company1,
    selectionSource: "bootstrap",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

const alice = {
  id: "user-alice",
  name: "Alice",
  email: "alice@example.com",
  image: null,
  isInstanceAdmin: false,
  activeCompanyMembershipCount: 2,
};

const bob = {
  id: "user-bob",
  name: "Bob",
  email: "bob@example.com",
  image: null,
  isInstanceAdmin: true,
  activeCompanyMembershipCount: 1,
};

function makeAccessResponse(userId: string, companyIds: string[] = []) {
  return {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: userId,
      image: null,
      isInstanceAdmin: userId === bob.id,
    },
    companyAccess: companyIds.map((companyId, i) => ({
      id: `membership-${i}`,
      companyId,
      principalType: "user" as const,
      principalId: userId,
      status: "active",
      membershipRole: "member",
      companyName: companyId === "comp-1" ? "Acme" : "Globex",
      companyStatus: "active",
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    })),
  };
}

describe("InstanceAccessPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchAdminUsers.mockResolvedValue([alice, bob]);
    mockGetUserCompanyAccess.mockResolvedValue(makeAccessResponse(alice.id, ["comp-1"]));
    mockSetUserCompanyAccess.mockResolvedValue(makeAccessResponse(alice.id, ["comp-1", "comp-2"]));
    mockPromoteInstanceAdmin.mockResolvedValue({ id: "role-1", userId: alice.id, role: "instance_admin" });
    mockDemoteInstanceAdmin.mockResolvedValue({ id: "role-1", userId: bob.id, role: "instance_admin" });
  });

  it("renders header + search input", async () => {
    renderWithProviders(<InstanceAccessPage />);
    expect(screen.getByText("Instance Access")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search by name or email")).toBeInTheDocument();
  });

  it("calls searchAdminUsers on mount and renders the user list", async () => {
    renderWithProviders(<InstanceAccessPage />);
    await waitFor(() => {
      expect(mockSearchAdminUsers).toHaveBeenCalledWith("");
    });
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Bob")).toBeInTheDocument();
  });

  it("re-queries with new needle when search input changes", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceAccessPage />);
    await screen.findByText("Alice");

    const input = screen.getByPlaceholderText("Search by name or email");
    await user.type(input, "bob");

    await waitFor(() => {
      expect(mockSearchAdminUsers).toHaveBeenCalledWith("bob");
    });
  });

  it("auto-selects the first user and fetches their company access", async () => {
    renderWithProviders(<InstanceAccessPage />);
    await waitFor(() => {
      expect(mockGetUserCompanyAccess).toHaveBeenCalledWith(alice.id);
    });
  });

  it("shows empty state when no users match the search", async () => {
    mockSearchAdminUsers.mockResolvedValue([]);
    renderWithProviders(<InstanceAccessPage />);
    expect(await screen.findByText(/No users match that search/i)).toBeInTheDocument();
  });

  it("shows admin-required error on 403", async () => {
    mockSearchAdminUsers.mockRejectedValue(new ApiError("Forbidden", 403, null));
    renderWithProviders(<InstanceAccessPage />);
    expect(
      await screen.findByText(/Instance admin access is required/i),
    ).toBeInTheDocument();
  });

  it("opens AlertDialog confirmation when promoting a user", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceAccessPage />);

    await user.click(
      await screen.findByRole("button", { name: /promote to instance admin/i }),
    );

    expect(
      await screen.findByRole("alertdialog", { name: /promote to instance admin/i }),
    ).toBeInTheDocument();
    expect(mockPromoteInstanceAdmin).not.toHaveBeenCalled();
  });

  it("calls promoteInstanceAdmin after confirming in the dialog", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceAccessPage />);

    await user.click(
      await screen.findByRole("button", { name: /promote to instance admin/i }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /^promote$/i }));

    await waitFor(() => {
      expect(mockPromoteInstanceAdmin).toHaveBeenCalledWith(alice.id);
    });
  });

  it("calls demoteInstanceAdmin after confirming removal for an admin user", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceAccessPage />);

    await user.click(await screen.findByText("Bob"));
    await waitFor(() => {
      expect(mockGetUserCompanyAccess).toHaveBeenCalledWith(bob.id);
    });

    await user.click(
      await screen.findByRole("button", { name: /remove instance admin/i }),
    );
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: /remove admin/i }));

    await waitFor(() => {
      expect(mockDemoteInstanceAdmin).toHaveBeenCalledWith(bob.id);
    });
  });

  it("saves company access when Save button is clicked", async () => {
    const user = userEvent.setup();
    renderWithProviders(<InstanceAccessPage />);

    await user.click(
      await screen.findByRole("button", { name: /save company access/i }),
    );

    await waitFor(() => {
      expect(mockSetUserCompanyAccess).toHaveBeenCalledWith(
        alice.id,
        expect.arrayContaining(["comp-1"]),
      );
    });
  });
});
