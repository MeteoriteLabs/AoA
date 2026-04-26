import { useEffect } from "react";
import { isKeyboardShortcutTextInputTarget } from "@/lib/keyboard-shortcuts-config";

interface ShortcutHandlers {
  onNewIssue?: () => void;
  onToggleSidebar?: () => void;
  onSwitchCompany?: (index: number) => void;
}

/**
 * Handles keyboard shortcuts for global navigation.
 *
 * Currently bound IDs from KEYBOARD_SHORTCUTS:
 *   - global.new_task       → onNewIssue
 *   - global.toggle_sidebar → onToggleSidebar
 *   - global.switch_company → onSwitchCompany
 *
 * T7 will add: global.cheatsheet → onShowCheatsheet
 */
export function useKeyboardShortcuts({ onNewIssue, onToggleSidebar, onSwitchCompany }: ShortcutHandlers) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Don't fire shortcuts when typing in inputs
      if (isKeyboardShortcutTextInputTarget(e.target)) {
        return;
      }

      // Cmd+1..9 → Switch company
      if ((e.metaKey || e.ctrlKey) && e.key >= "1" && e.key <= "9") {
        e.preventDefault();
        onSwitchCompany?.(parseInt(e.key, 10) - 1);
        return;
      }

      // C → New Issue
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        onNewIssue?.();
      }

      // [ → Toggle Sidebar
      if (e.key === "[" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        onToggleSidebar?.();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onNewIssue, onToggleSidebar, onSwitchCompany]);
}
