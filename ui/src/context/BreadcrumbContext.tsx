import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export interface Breadcrumb {
  label: string;
  href?: string;
}

interface BreadcrumbContextValue {
  breadcrumbs: Breadcrumb[];
  setBreadcrumbs: (crumbs: Breadcrumb[]) => void;
  subtitle: string | null;
  setSubtitle: (sub: string | null) => void;
  entityColor: string | null;
  setEntityColor: (color: string | null) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue | null>(null);

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [breadcrumbs, setBreadcrumbsState] = useState<Breadcrumb[]>([]);
  const [subtitle, setSubtitleState] = useState<string | null>(null);
  const [entityColor, setEntityColorState] = useState<string | null>(null);

  const setBreadcrumbs = useCallback((crumbs: Breadcrumb[]) => {
    setBreadcrumbsState(crumbs);
  }, []);

  const setSubtitle = useCallback((sub: string | null) => {
    setSubtitleState(sub);
  }, []);

  const setEntityColor = useCallback((color: string | null) => {
    setEntityColorState(color);
  }, []);

  useEffect(() => {
    if (breadcrumbs.length === 0) {
      document.title = "AoA";
    } else {
      const parts = [...breadcrumbs].reverse().map((b) => b.label);
      document.title = `${parts.join(" · ")} · AoA`;
    }
  }, [breadcrumbs]);

  return (
    <BreadcrumbContext.Provider value={{ breadcrumbs, setBreadcrumbs, subtitle, setSubtitle, entityColor, setEntityColor }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

export function useBreadcrumbs() {
  const ctx = useContext(BreadcrumbContext);
  if (!ctx) {
    throw new Error("useBreadcrumbs must be used within BreadcrumbProvider");
  }
  return ctx;
}
