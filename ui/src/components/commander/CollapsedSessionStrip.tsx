import type { ConversationRow } from "../../api/internal-agent";

// TODO(Task 6): Replace this shell with the full 40px collapsed icon strip.
// Will render pinned + recent session avatars/icons in a vertical strip
// with tooltip previews and click-to-expand behavior.

export interface CollapsedSessionStripProps {
  conversations: ConversationRow[];
  activeConversationId: string | null;
  onSelect: (conversationId: string) => void;
  onExpand: () => void;
}

export function CollapsedSessionStrip(_props: CollapsedSessionStripProps) {
  // Shell — no-op until Task 6
  return null;
}
