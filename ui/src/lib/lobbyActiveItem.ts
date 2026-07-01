import type { LobbySidebarItem } from "@/components/LobbySidebar";

/** Derive which lobby sidebar row is active from the current route path. */
export function lobbyActiveItem(pathname: string): LobbySidebarItem {
  const path = pathname.split("?")[0];
  if (path.startsWith("/marketplace")) return "marketplace";
  if (path.startsWith("/instance/settings")) return "settings";
  // "/" and everything else default to the organizations list.
  return "organizations";
}
