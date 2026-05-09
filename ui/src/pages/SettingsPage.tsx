import { useEffect } from "react";
import { useSearchParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { SettingsLayout, type SettingsSectionId } from "@/components/settings/SettingsLayout";

const VALID_SECTIONS: readonly SettingsSectionId[] = [
  "general", "commander", "llm", "budget", "mcp", "plugins", "marketplace", "archive",
];

function isValidSection(s: string | null): s is SettingsSectionId {
  return s != null && (VALID_SECTIONS as readonly string[]).includes(s);
}

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { setBreadcrumbs } = useBreadcrumbs();

  const tabParam = searchParams.get("tab");
  const activeSection: SettingsSectionId = isValidSection(tabParam) ? tabParam : "general";

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings" }]);
  }, [setBreadcrumbs]);

  const handleSectionChange = (id: SettingsSectionId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("tab", id);
      // Drop sub-tab param when switching sections
      next.delete("sub");
      return next;
    });
  };

  return (
    <SettingsLayout activeSection={activeSection} onSectionChange={handleSectionChange}>
      <div className="p-8">
        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
          Settings · {activeSection}
        </div>
        <div className="mt-2 text-sm text-muted-foreground italic">
          Section content will be wired in subsequent tasks (T2-T6).
        </div>
      </div>
    </SettingsLayout>
  );
}
