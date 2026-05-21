import type { ConversationRow } from "../../api/internal-agent";

// TODO(Task 4): Replace this shell with the full single-line row implementation.
// Will include ○/● run-status indicator, Pin badge, overflow menu trigger,
// and keyboard navigation support.

export interface SessionRowProps {
  conversation: ConversationRow;
  isActive: boolean;
  onSelect: () => void;
}

export function SessionRow({ conversation, isActive, onSelect }: SessionRowProps) {
  const title = conversation.title ?? `Chat ${conversation.id.slice(0, 8)}`;
  return (
    <button
      type="button"
      className={isActive ? "font-medium" : ""}
      onClick={onSelect}
    >
      {title}
    </button>
  );
}
