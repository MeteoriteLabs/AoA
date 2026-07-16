/**
 * useComposerMention — shared typed-@ + button-picker mention state for
 * plain-textarea composer surfaces (Workspace chatbar, Task Comments).
 *
 * Approved mock v2: every composer's @ works the same way — the @ button
 * opens the picker (first item preselected, Enter picks), and a trailing
 * `@token` in the text opens the same list inline. Discussion and Commander
 * already have richer inline engines (people+users, contenteditable tokens);
 * this hook brings the remaining surfaces up to the same contract with the
 * company's agents as mention targets (the server wakes @mentioned agents on
 * task/workspace comments — issues.ts findMentionedAgents).
 */
import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { agentsApi } from "@/api/agents";
import type { MentionOption } from "./ComposerMentionMenu";

/** Detect a trailing `@token` (same rule as EntryComposer/threads). */
export function detectTrailingMention(text: string, caret: number): string | null {
  const upToCaret = text.slice(0, caret);
  const match = /(^|\s)@([\w-]*)$/.exec(upToCaret);
  return match ? match[2] : null;
}

export interface UseComposerMentionArgs {
  companyId: string | null | undefined;
  /** Current input value + a setter that also re-focuses the input. */
  value: string;
  onChange: (next: string) => void;
  /** Focus the underlying input and place the caret at `pos`. */
  focusAt: (pos: number) => void;
}

export function useComposerMention({ companyId, value, onChange, focusAt }: UseComposerMentionArgs) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  // Server-side @mention resolution on comments matches org + aoa agents
  // (issues.ts findMentionedAgents) — offer the same set in the picker.
  const { data: agents = [] } = useQuery({
    queryKey: ["composer-mention-agents", companyId],
    queryFn: async () => {
      const [org, aoa] = await Promise.all([
        agentsApi.list(companyId as string),
        agentsApi.listAoa(companyId as string).catch(() => []),
      ]);
      const seen = new Set<string>();
      return [...org, ...aoa].filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    },
    enabled: !!companyId && open,
    staleTime: 60_000,
  });

  const options: MentionOption[] = useMemo(
    () =>
      (agents as Array<{ id: string; name: string; status?: string; icon?: string | null }>)
        .filter((a) => a.status !== "terminated")
        .filter((a) => a.name.toLowerCase().startsWith(query.toLowerCase()))
        .slice(0, 8)
        .map((a) => ({ id: a.id, name: a.name, type: "agent" as const, icon: a.icon ?? null })),
    [agents, query],
  );

  /** Re-evaluate on every text/caret change (wire to onChange/onSelect). */
  const refresh = useCallback((text: string, caret: number) => {
    const token = detectTrailingMention(text, caret);
    if (token === null) {
      setOpen(false);
      return;
    }
    setQuery(token);
    setIndex(0);
    setOpen(true);
  }, []);

  /** @ button: append "@" (space-separated) and open the picker. */
  const openViaButton = useCallback(() => {
    const next = value.length === 0 || /\s$/.test(value) ? `${value}@` : `${value} @`;
    onChange(next);
    setQuery("");
    setIndex(0);
    setOpen(true);
    requestAnimationFrame(() => focusAt(next.length));
  }, [value, onChange, focusAt]);

  /** Replace the trailing @token with the picked mention. */
  const select = useCallback(
    (option: MentionOption) => {
      const caretText = value;
      const match = /(^|\s)@([\w-]*)$/.exec(caretText);
      const start = match ? caretText.length - match[2].length - 1 : caretText.length;
      const next = `${caretText.slice(0, start)}@${option.name} `;
      onChange(next);
      setOpen(false);
      requestAnimationFrame(() => focusAt(next.length));
    },
    [value, onChange, focusAt],
  );

  /** Keyboard contract while open: ↑/↓ navigate, Enter picks, Esc closes. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open) return false;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, Math.max(options.length - 1, 0)));
        return true;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
        return true;
      }
      if (e.key === "Enter" && options.length > 0) {
        e.preventDefault();
        select(options[index] ?? options[0]);
        return true;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return true;
      }
      return false;
    },
    [open, options, index, select],
  );

  return {
    open,
    options,
    index,
    setIndex,
    refresh,
    openViaButton,
    select,
    handleKeyDown,
    close: () => setOpen(false),
  };
}
