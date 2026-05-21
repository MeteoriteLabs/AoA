import type { ConversationRow } from "../../api/internal-agent";

// TODO(Task 5): Replace this shell with the full overflow menu implementation.
// Will include Pin/Unpin, Rename, Archive, and Delete actions via a popover/dropdown.

export interface SessionOverflowMenuProps {
  conversation: ConversationRow;
  onPin: (pinned: boolean) => void;
  onRename: (title: string) => void;
  onArchive: () => void;
  onDelete?: () => void;
}

export function SessionOverflowMenu(_props: SessionOverflowMenuProps) {
  // Shell — no-op until Task 5
  return null;
}
