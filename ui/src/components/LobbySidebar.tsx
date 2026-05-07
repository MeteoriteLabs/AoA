import { Building2, Settings, Store } from "lucide-react";
import { useNavigate } from "@/lib/router";
import { UserMenu } from "@/components/UserMenu";
import { cn } from "@/lib/utils";

interface LobbyNavRowProps {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}

function LobbyNavRow({ icon: Icon, label, active, onClick }: LobbyNavRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? "true" : undefined}
      className={cn(
        "flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-[13px] font-medium transition-colors",
        active
          ? "bg-white/[0.06] text-text shadow-[inset_2px_0_0_var(--brand)]"
          : "text-text/[0.78] hover:bg-white/[0.04] hover:text-text",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left truncate">{label}</span>
    </button>
  );
}

/**
 * Sidebar for the global Lobby page.
 *
 * Pre-company-selection chrome — the company-scoped {@link Sidebar} is mounted
 * inside `CompanyLayout` once a company is active. This sidebar shows brand,
 * three top-level destinations (Companies / Marketplace / Settings), and a
 * UserMenu at the bottom.
 */
export function LobbySidebar() {
  const navigate = useNavigate();

  return (
    <aside className="flex flex-col w-[220px] shrink-0 h-dvh border-r border-border bg-card/50 backdrop-blur-sm lobby-sidebar-enter">
      {/* Brand */}
      <div className="flex items-center h-14 px-4 shrink-0 border-b border-border">
        <span className="text-sm font-bold tracking-tight text-text">
          AoA<span className="text-brand">.</span>
        </span>
      </div>

      {/* Nav rows */}
      <nav className="flex-1 flex flex-col gap-0.5 p-2">
        <LobbyNavRow
          icon={Building2}
          label="Companies"
          active
          onClick={() => navigate("/")}
        />
        <LobbyNavRow
          icon={Store}
          label="Marketplace"
          onClick={() => navigate("/marketplace")}
        />
        <LobbyNavRow
          icon={Settings}
          label="Settings"
          onClick={() => navigate("/instance/settings")}
        />
      </nav>

      {/* User menu */}
      <div className="shrink-0 border-t border-border p-2">
        <UserMenu />
      </div>
    </aside>
  );
}
