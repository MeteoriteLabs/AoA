import { useEffect } from "react";
import { useSearchParams } from "@/lib/router";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { SettingsLayout, type SettingsSectionId } from "@/components/settings/SettingsLayout";
import { GeneralSection } from "@/components/settings/sections/GeneralSection";
import { ArchiveCompanySection } from "@/components/settings/sections/ArchiveCompanySection";
import { BudgetCapsSection } from "@/components/settings/sections/BudgetCapsSection";
import { MCPApiKeysSection } from "@/components/settings/sections/MCPApiKeysSection";
import { LLMProvidersSectionWrapper } from "@/components/settings/sections/LLMProvidersSectionWrapper";
import { PluginsSectionWrapper } from "@/components/settings/sections/PluginsSectionWrapper";
import { MarketplacePrefsSection } from "@/components/settings/sections/MarketplacePrefsSection";
import { CommanderSection } from "@/components/settings/sections/CommanderSection";

const VALID_SECTIONS: readonly SettingsSectionId[] = [
  "general", "commander", "llm", "budget", "mcp", "plugins", "marketplace", "archive",
];

function isValidSection(s: string | null): s is SettingsSectionId {
  return s != null && (VALID_SECTIONS as readonly string[]).includes(s);
}

function renderActiveSection(id: SettingsSectionId) {
  switch (id) {
    case "general":
      return <GeneralSection />;
    case "commander":
      return <CommanderSection />;
    case "llm":
      return <LLMProvidersSectionWrapper />;
    case "budget":
      return <BudgetCapsSection />;
    case "mcp":
      return <MCPApiKeysSection />;
    case "plugins":
      return <PluginsSectionWrapper />;
    case "marketplace":
      return <MarketplacePrefsSection />;
    case "archive":
      return <ArchiveCompanySection />;
    default: {
      const exhaustive: never = id;
      return (
        <div className="p-8">
          <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/60 font-semibold">
            Settings · {exhaustive}
          </div>
          <div className="mt-2 text-sm text-muted-foreground italic">
            Unknown section.
          </div>
        </div>
      );
    }
  }
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
      {renderActiveSection(activeSection)}
    </SettingsLayout>
  );
}
