import { useEffect } from "react";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Settings } from "lucide-react";

export function InternalAgentSettingsPage() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompany } = useCompany();

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/home" },
      { label: "Settings", href: "/settings" },
      { label: "Internal Agent" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  return (
    <div className="max-w-3xl space-y-1">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Internal Agent Settings</h1>
      </div>
    </div>
  );
}
