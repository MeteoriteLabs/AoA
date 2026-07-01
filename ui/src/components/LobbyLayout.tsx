import { useState, type ReactNode } from "react";
import { Outlet, useLocation } from "@/lib/router";
import { useDialog } from "@/context/DialogContext";
import { LobbyShell } from "@/components/LobbyShell";
import { lobbyActiveItem } from "@/lib/lobbyActiveItem";

/**
 * Context handed to lobby child routes so a page can fill the shell's
 * secondary-sidebar slot (only Settings uses it today). Read it with
 * `useOutletContext<LobbyOutletContext>()`.
 */
export interface LobbyOutletContext {
  setSecondarySidebar: (node: ReactNode | null) => void;
}

/**
 * Persistent layout route for the lobby-tier pages (Lobby, Marketplace*,
 * Settings). Renders {@link LobbyShell} ONCE and swaps page content via
 * `<Outlet/>`, so the sidebar no longer remounts (and re-animates) on every
 * navigation. `activeItem` is derived from the route; a child page can provide
 * a secondary sidebar via the outlet context.
 */
export function LobbyLayout() {
  const { openOnboarding } = useDialog();
  const location = useLocation();
  const [secondarySidebar, setSecondarySidebar] = useState<ReactNode | null>(null);

  return (
    <LobbyShell
      activeItem={lobbyActiveItem(location.pathname)}
      onCreateCompany={() => openOnboarding()}
      secondarySidebar={secondarySidebar}
    >
      <Outlet context={{ setSecondarySidebar } satisfies LobbyOutletContext} />
    </LobbyShell>
  );
}
