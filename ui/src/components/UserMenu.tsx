import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { LogOut, RotateCcw, User as UserIcon } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { profileApi } from "../api/profile";
import { useCompany } from "../context/CompanyContext";
import { useAccountSwitch } from "../hooks/useAccountSwitch";
import { useSidebarOrder } from "../hooks/useSidebarOrder";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

function deriveInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2)
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

interface UserMenuProps {
  /** Collapsed layout: avatar-only trigger (for collapsed sidebar). */
  collapsed?: boolean;
  className?: string;
}

export function UserMenu({ collapsed, className }: UserMenuProps) {
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { switchAccount, isSwitching, error: switchError } = useAccountSwitch();
  const { resetToDefault: resetSidebarOrder } =
    useSidebarOrder(selectedCompanyId);

  const { data: profile } = useQuery({
    queryKey: queryKeys.auth.profile,
    queryFn: () => profileApi.get(),
    staleTime: 60_000,
  });

  const displayName = profile?.displayName ?? profile?.email ?? "Account";
  const initials = deriveInitials(displayName);

  const triggerContent = (
    <>
      <Avatar
        size={collapsed ? "sm" : "default"}
        shape="squircle"
        className="shrink-0"
      >
        {profile?.avatarUrl ? (
          <AvatarImage src={profile.avatarUrl} alt={displayName} />
        ) : null}
        <AvatarFallback>{initials}</AvatarFallback>
      </Avatar>
      {!collapsed && (
        <span className="flex-1 min-w-0 text-left">
          <span className="block truncate text-sm font-medium">
            {displayName}
          </span>
          {profile?.email && profile.email !== displayName && (
            <span className="block truncate text-xs text-muted-foreground">
              {profile.email}
            </span>
          )}
        </span>
      )}
    </>
  );

  const trigger = (
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        aria-label="Account menu"
        className={cn(
          "flex items-center rounded-md text-foreground transition-colors",
          "hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          collapsed
            ? "justify-center w-8 h-8 mx-auto"
            : "w-full gap-2 px-2 py-1.5",
          className
        )}
      >
        {triggerContent}
      </button>
    </DropdownMenuTrigger>
  );

  return (
    <>
      <DropdownMenu>
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>{trigger}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {displayName}
            </TooltipContent>
          </Tooltip>
        ) : (
          trigger
        )}
        <DropdownMenuContent
          align={collapsed ? "start" : "end"}
          side="top"
          sideOffset={8}
          className="min-w-48"
        >
          <DropdownMenuItem onSelect={() => navigate("/me")}>
            <UserIcon />
            Profile
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={resetSidebarOrder}
            disabled={!selectedCompanyId}
          >
            <RotateCcw />
            Reset sidebar to default
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => void switchAccount()}
            disabled={isSwitching}
          >
            <LogOut />
            {isSwitching ? "Signing out..." : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {switchError ? (
        <p className="mt-1 max-w-64 px-2 text-xs text-destructive" role="alert">
          {switchError}
        </p>
      ) : null}
    </>
  );
}
