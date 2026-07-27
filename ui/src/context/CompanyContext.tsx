import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { Company } from "@armyofagents/shared";
import { companiesApi } from "../api/companies";
import { authApi } from "../api/auth";
import { ApiError } from "../api/client";
import { queryKeys } from "../lib/queryKeys";

type CompanySelectionSource = "manual" | "route_sync" | "bootstrap";
type CompanySelectionOptions = { source?: CompanySelectionSource };

interface CompanyContextValue {
  companies: Company[];
  selectedCompanyId: string | null;
  selectedCompany: Company | null;
  selectionSource: CompanySelectionSource;
  loading: boolean;
  error: Error | null;
  setSelectedCompanyId: (
    companyId: string | null,
    options?: CompanySelectionOptions
  ) => void;
  resetCompanySelection: () => void;
  reloadCompanies: () => Promise<void>;
  createCompany: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) => Promise<Company>;
}

const STORAGE_KEY_PREFIX = "aoa.selectedCompanyId";

export function resolveBootstrapCompanySelection(input: {
  companies: Company[];
  sidebarCompanies: Company[];
  selectedCompanyId: string | null;
  storedCompanyId: string | null;
}): string | null {
  if (input.companies.length === 0) return null;
  const selectableCompanies =
    input.sidebarCompanies.length > 0
      ? input.sidebarCompanies
      : input.companies;
  if (
    input.selectedCompanyId &&
    selectableCompanies.some((c) => c.id === input.selectedCompanyId)
  ) {
    return input.selectedCompanyId;
  }
  if (
    input.storedCompanyId &&
    selectableCompanies.some((c) => c.id === input.storedCompanyId)
  ) {
    return input.storedCompanyId;
  }
  return selectableCompanies[0]?.id ?? null;
}

export function shouldClearStoredCompanySelection(input: {
  companies: Company[];
  isLoading: boolean;
  unauthorized: boolean;
}): boolean {
  return (
    !input.isLoading && !input.unauthorized && input.companies.length === 0
  );
}

const CompanyContext = createContext<CompanyContextValue | null>(null);

export function CompanyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [selectionSource, setSelectionSource] =
    useState<CompanySelectionSource>("bootstrap");
  const [selectedCompanyId, setSelectedCompanyIdState] = useState<
    string | null
  >(null);
  const sessionQuery = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const identityKey = sessionQuery.data?.user.id ?? "local";
  const storageKey = `${STORAGE_KEY_PREFIX}.${identityKey}`;

  const companiesQuery = useQuery({
    queryKey: queryKeys.companies.forIdentity(identityKey),
    queryFn: async () => {
      try {
        return { companies: await companiesApi.list(), unauthorized: false };
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          return { companies: [] as Company[], unauthorized: true };
        }
        throw err;
      }
    },
    enabled: !sessionQuery.isLoading,
    retry: false,
  });
  const companies = companiesQuery.data?.companies ?? [];
  const unauthorized = companiesQuery.data?.unauthorized ?? false;
  const isLoading = companiesQuery.isLoading;
  const error = companiesQuery.error;
  const sidebarCompanies = useMemo(
    () => companies.filter((company) => company.status !== "archived"),
    [companies]
  );

  // Auto-select company on bootstrap, validating stored id against loaded list
  useEffect(() => {
    if (isLoading) return;
    if (
      shouldClearStoredCompanySelection({ companies, isLoading, unauthorized })
    ) {
      setSelectedCompanyIdState(null);
      localStorage.removeItem(storageKey);
      return;
    }
    const storedCompanyId = localStorage.getItem(storageKey);
    const resolved = resolveBootstrapCompanySelection({
      companies,
      sidebarCompanies: sidebarCompanies ?? [],
      selectedCompanyId,
      storedCompanyId,
    });
    if (resolved !== selectedCompanyId) {
      setSelectedCompanyIdState(resolved);
      setSelectionSource("bootstrap");
      if (resolved) localStorage.setItem(storageKey, resolved);
    }
  }, [
    companies,
    sidebarCompanies,
    isLoading,
    unauthorized,
    selectedCompanyId,
    storageKey,
  ]);

  const setSelectedCompanyId = useCallback(
    (companyId: string | null, options?: CompanySelectionOptions) => {
      setSelectedCompanyIdState(companyId);
      setSelectionSource(options?.source ?? "manual");
      if (companyId) localStorage.setItem(storageKey, companyId);
      else localStorage.removeItem(storageKey);
    },
    [storageKey]
  );

  const resetCompanySelection = useCallback(() => {
    setSelectedCompanyIdState(null);
    setSelectionSource("bootstrap");
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const reloadCompanies = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => companiesApi.create(data),
    onSuccess: (company) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(company.id);
    },
  });

  const createCompany = useCallback(
    async (data: {
      name: string;
      description?: string | null;
      budgetMonthlyCents?: number;
    }) => {
      return createMutation.mutateAsync(data);
    },
    [createMutation]
  );

  const selectedCompany = useMemo(
    () => companies.find((company) => company.id === selectedCompanyId) ?? null,
    [companies, selectedCompanyId]
  );

  const value = useMemo(
    () => ({
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      loading: isLoading,
      error: error as Error | null,
      setSelectedCompanyId,
      resetCompanySelection,
      reloadCompanies,
      createCompany,
    }),
    [
      companies,
      selectedCompanyId,
      selectedCompany,
      selectionSource,
      isLoading,
      error,
      setSelectedCompanyId,
      resetCompanySelection,
      reloadCompanies,
      createCompany,
    ]
  );

  return (
    <CompanyContext.Provider value={value}>{children}</CompanyContext.Provider>
  );
}

export function useCompany() {
  const ctx = useContext(CompanyContext);
  if (!ctx) {
    throw new Error("useCompany must be used within CompanyProvider");
  }
  return ctx;
}
