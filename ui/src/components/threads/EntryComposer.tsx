/**
 * EntryComposer — Phase E1 thread chat composer.
 *
 * Rich textarea where:
 *  - Typing `@` opens an autocomplete dropdown (agents + users)
 *  - Selecting a suggestion inserts a styled chip token in the text
 *  - The attachment button uploads files to /assets/files and attaches the
 *    resulting asset ids to the entry on submit
 *  - Ctrl+Enter (or Cmd+Enter on macOS) submits the entry
 *  - When `parentEntryId` is set the composer renders with reply styling and
 *    the resulting entry is posted as a reply
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { Paperclip, SendHorizonal, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  COMPOSER_ATTACHMENT_CONTENT_TYPES,
  COMPOSER_MAX_ATTACHMENTS,
  COMPOSER_MAX_ATTACHMENT_BYTES,
} from "@armyofagents/shared";
import {
  EntryAutocompleteList,
  type EntrySuggestion,
} from "./EntryAutocompleteList";
import { FileArtifactUpload } from "./FileArtifactUpload";

/* ─── Public types ─── */

export interface AgentRef {
  id: string;
  name: string;
  icon?: string | null;
  role?: string | null;
}
export interface UserRef {
  id: string;
  name: string;
  email?: string | null;
}
export interface AssetRef {
  id: string;
  name: string;
  mimeType: string;
  /** Set when this attachment is a tracked artifact (founder file-artifact upload). */
  artifactId?: string;
}
export interface Mention {
  id: string;
  name: string;
  type: "agent" | "user";
}

export interface EntryComposerProps {
  threadId: string;
  /** Company scope — used by the founder file-artifact upload control. */
  companyId: string;
  parentEntryId?: string | null;
  agents: AgentRef[];
  users: UserRef[];
  /**
   * Uploader called per file when the user picks files via the paperclip
   * button. Must return an AssetRef. Defaulted by the consumer (ThreadTab)
   * to POST /companies/:cid/assets/files.
   */
  onUpload?: (file: File) => Promise<AssetRef>;
  onSubmit: (payload: {
    text: string;
    mentions: string[];
    parentEntryId: string | null;
    attachments: AssetRef[];
  }) => void | Promise<void>;
  /** Called when submission fails; the composer keeps its draft snapshot. */
  onSubmitError?: (error: unknown) => void;
  /** Composer is disabled (offline, error, etc.) and visually shows it. */
  disabled?: boolean;
  /** Founder-only control for creating tracked file artifacts. */
  canCreateFileArtifacts?: boolean;
  /** Optional inline hint shown above the input (e.g. offline notice). */
  hint?: React.ReactNode;
  /** Placeholder override. */
  placeholder?: string;
  /** Show the cancel-reply button (renders only when parentEntryId is set). */
  onCancelReply?: () => void;
  /** Avatar initials for the current user. */
  myInitials?: string;
  /** Optional host-owned text draft. Omit for the native uncontrolled composer. */
  draftText?: string;
  onDraftTextChange?: (text: string) => void;
}

/* ─── Helpers ─── */

const MAX_SUGGESTIONS = 8;

/**
 * Find a trailing `@token` immediately before the caret. Token = word chars only.
 * Returns null when the caret isn't inside or just after a token. The
 * leading-or-whitespace-boundary check mirrors MentionInput's regex so we
 * don't fire on emails / @-prefixed code.
 */
function detectMentionToken(
  value: string,
  caret: number,
): { start: number; end: number; token: string } | null {
  if (caret <= 0) return null;
  // Walk backward from the caret to find the @ that starts a token.
  let i = caret - 1;
  while (i >= 0) {
    const ch = value[i];
    if (ch === "@") {
      // Make sure @ is at the start or follows whitespace.
      if (i === 0 || /\s/.test(value[i - 1] ?? "")) {
        const token = value.slice(i + 1, caret);
        // Only word chars; abort on whitespace breaks (we already walked).
        if (/^\w*$/.test(token)) {
          return { start: i, end: caret, token };
        }
      }
      return null;
    }
    if (/\s/.test(ch)) return null;
    i -= 1;
  }
  return null;
}

/* ─── Component ─── */

export function EntryComposer({
  threadId,
  companyId,
  parentEntryId = null,
  agents,
  users,
  onUpload,
  onSubmit,
  onSubmitError,
  disabled = false,
  canCreateFileArtifacts = false,
  hint,
  placeholder,
  onCancelReply,
  myInitials = "Me",
  draftText,
  onDraftTextChange,
}: EntryComposerProps) {
  const [uncontrolledText, setUncontrolledText] = useState("");
  const text = draftText ?? uncontrolledText;
  const setText = (next: string) => {
    if (draftText === undefined) setUncontrolledText(next);
    onDraftTextChange?.(next);
  };
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [attachments, setAttachments] = useState<AssetRef[]>([]);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteToken, setAutocompleteToken] = useState("");
  const [autocompleteRange, setAutocompleteRange] = useState<{ start: number; end: number } | null>(null);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo<EntrySuggestion[]>(() => {
    if (!autocompleteOpen) return [];
    const q = autocompleteToken.toLowerCase();
    const filterAgent = (a: AgentRef) => !q || a.name.toLowerCase().includes(q);
    const filterUser = (u: UserRef) =>
      !q ||
      u.name.toLowerCase().includes(q) ||
      (u.email ?? "").toLowerCase().includes(q);
    const agentMatches: EntrySuggestion[] = agents.filter(filterAgent).map((a) => ({
      id: a.id,
      name: a.name,
      type: "agent",
      icon: a.icon ?? null,
      subtitle: a.role ?? null,
    }));
    const userMatches: EntrySuggestion[] = users.filter(filterUser).map((u) => ({
      id: u.id,
      name: u.name,
      type: "user",
      icon: null,
      subtitle: u.email ?? null,
    }));
    return [...agentMatches, ...userMatches].slice(0, MAX_SUGGESTIONS);
  }, [agents, users, autocompleteOpen, autocompleteToken]);

  // Reset selection when the suggestion list changes shape
  useEffect(() => {
    setAutocompleteIndex(0);
  }, [autocompleteToken, autocompleteOpen]);

  /**
   * Run whenever text or caret moves: detect a trailing `@token` and either
   * open the autocomplete with that filter or close it.
   */
  const refreshAutocompleteState = useCallback(
    (value: string, caret: number) => {
      const hit = detectMentionToken(value, caret);
      if (hit) {
        setAutocompleteOpen(true);
        setAutocompleteToken(hit.token);
        setAutocompleteRange({ start: hit.start, end: hit.end });
      } else {
        setAutocompleteOpen(false);
        setAutocompleteToken("");
        setAutocompleteRange(null);
      }
    },
    [],
  );

  function handleTextChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value;
    setText(next);
    const caret = e.target.selectionStart ?? next.length;
    refreshAutocompleteState(next, caret);
  }

  function applyAutocompleteSelection(s: EntrySuggestion) {
    if (!autocompleteRange) return;
    const { start, end } = autocompleteRange;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const replacement = `@${s.name} `;
    const next = `${before}${replacement}${after}`;
    setText(next);
    setMentions((prev) =>
      prev.some((m) => m.id === s.id && m.type === s.type)
        ? prev
        : [...prev, { id: s.id, name: s.name, type: s.type }],
    );
    setAutocompleteOpen(false);
    setAutocompleteToken("");
    setAutocompleteRange(null);
    // Restore caret position after the inserted mention.
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      const pos = start + replacement.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (autocompleteOpen && suggestions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setAutocompleteIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setAutocompleteIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === "Enter" && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        applyAutocompleteSelection(suggestions[autocompleteIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setAutocompleteOpen(false);
        return;
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    // Reset the input so picking the same file twice still triggers onChange.
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0 || !onUpload) return;
    const available = COMPOSER_MAX_ATTACHMENTS - attachments.length - uploadingFiles.length;
    if (files.length > available) {
      setAttachmentError(`Attach up to ${COMPOSER_MAX_ATTACHMENTS} files per message.`);
    }
    const accepted = files.slice(0, Math.max(0, available)).filter((file) => {
      if (!COMPOSER_ATTACHMENT_CONTENT_TYPES.includes(file.type as (typeof COMPOSER_ATTACHMENT_CONTENT_TYPES)[number])) {
        setAttachmentError(`Unsupported attachment type: ${file.type || "unknown"}.`);
        return false;
      }
      if (file.size > COMPOSER_MAX_ATTACHMENT_BYTES) {
        setAttachmentError(`${file.name} exceeds the 10 MB attachment limit.`);
        return false;
      }
      return true;
    });
    for (const file of accepted) {
      setUploadingFiles((prev) => [...prev, file.name]);
      try {
        const asset = await onUpload(file);
        setAttachments((prev) => [...prev, asset]);
      } catch {
        setAttachmentError(`Could not upload ${file.name}. Retry from the file picker.`);
      } finally {
        setUploadingFiles((prev) => prev.filter((n) => n !== file.name));
      }
    }
  }

  function removeAttachment(id: string) {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }

  async function handleSubmit() {
    const trimmed = text.trim();
    if ((!trimmed && attachments.length === 0) || isSubmitting || disabled || uploadingFiles.length > 0) return;
    setAttachmentError(null);
    setIsSubmitting(true);
    try {
      await onSubmit({
        text: trimmed,
        mentions: mentions.map((m) => m.id),
        parentEntryId: parentEntryId ?? null,
        attachments,
      });
      setText("");
      setMentions([]);
      setAttachments([]);
      setAutocompleteOpen(false);
    } catch (error) {
      onSubmitError?.(error);
    } finally {
      setIsSubmitting(false);
    }
  }

  const isReply = !!parentEntryId;

  return (
    <div
      className={cn(
        "shrink-0 px-4 py-3 border-t border-border relative",
        isReply && "border-l-2 border-l-primary/50",
      )}
      style={{ background: "var(--card, #161a20)" }}
      data-testid="entry-composer"
      data-thread-id={threadId}
      data-reply={isReply ? "true" : undefined}
      data-parent-entry-id={parentEntryId ?? undefined}
    >
      {hint && (
        <div
          className="mb-2 rounded-md px-3 py-1.5 text-xs text-muted-foreground"
          style={{ background: "hsl(38 20% 10%)", border: "1px solid rgba(217,169,56,0.25)" }}
          data-testid="entry-composer-hint"
        >
          {hint}
        </div>
      )}

      {isReply && (
        <div className="flex items-center gap-2 mb-1.5 text-[11px] text-muted-foreground">
          <span className="font-semibold text-foreground/80">Reply</span>
          {onCancelReply && (
            <button
              type="button"
              onClick={onCancelReply}
              className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
              data-testid="entry-composer-cancel-reply"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          )}
        </div>
      )}

      {attachmentError && (
        <div className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs text-destructive" role="alert">
          {attachmentError}
        </div>
      )}

      {/* Inline attachment previews */}
      {(attachments.length > 0 || uploadingFiles.length > 0) && (
        <div
          className="flex flex-wrap gap-2 mb-2"
          data-testid="entry-composer-attachments"
        >
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-[11px] text-foreground"
              data-testid={`entry-composer-attachment-${a.name}`}
            >
              <FileText className="h-3 w-3" />
              <span className="truncate max-w-[160px]">{a.name}</span>
              <button
                type="button"
                onClick={() => removeAttachment(a.id)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${a.name}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {uploadingFiles.map((name) => (
            <span
              key={`uploading-${name}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground"
            >
              <Loader2 className="h-3 w-3 animate-spin" />
              <span className="truncate max-w-[160px]">{name}</span>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5">
        {/* User avatar (top-level only — replies skip the avatar for compactness) */}
        {!isReply && (
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0"
            style={{ background: "hsl(221 22% 34%)" }}
            aria-hidden="true"
          >
            {myInitials}
          </div>
        )}

        {/* Input area */}
        <div
          className={cn(
            "flex-1 flex items-center gap-1 rounded-xl border border-border/80 px-3 focus-within:border-border relative",
          )}
          style={{ background: "var(--field, #0e1014)" }}
        >
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onSelect={(e) => {
              const t = e.currentTarget;
              refreshAutocompleteState(t.value, t.selectionStart ?? 0);
            }}
            onBlur={() => {
              // Close after a tick so click selection on the dropdown can finish.
              setTimeout(() => setAutocompleteOpen(false), 100);
            }}
            placeholder={placeholder ?? (isReply ? "Reply…" : "Reply… @mention to summon crew")}
            rows={1}
            className="flex-1 bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none min-h-[40px] max-h-[120px]"
            style={{ lineHeight: "1.4" }}
            disabled={disabled || isSubmitting}
            aria-label={isReply ? "Write a reply" : "Write a message"}
            data-testid="entry-composer-textarea"
          />

          {/* Attach button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            title="Attach file"
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            disabled={disabled || isSubmitting || !onUpload}
            data-testid="entry-composer-attach-button"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
            data-testid="entry-composer-file-input"
            aria-label="File attachment input"
          />

          {canCreateFileArtifacts ? (
            <div className="shrink-0">
              <FileArtifactUpload
                companyId={companyId}
                onUploaded={(artifact) =>
                  setAttachments((prev) => [
                    ...prev,
                    { id: artifact.id, name: artifact.title, mimeType: artifact.type, artifactId: artifact.id },
                  ])
                }
                disabled={disabled || isSubmitting}
              />
            </div>
          ) : null}

          {/* Autocomplete dropdown */}
          {autocompleteOpen && (
            <EntryAutocompleteList
              suggestions={suggestions}
              selectionIndex={autocompleteIndex}
              onSelect={applyAutocompleteSelection}
              onHover={(i) => setAutocompleteIndex(i)}
            />
          )}
        </div>

        {/* Send button */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={(!text.trim() && attachments.length === 0) || isSubmitting || disabled || uploadingFiles.length > 0}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40"
          style={{ background: "#b82d1c" }}
          aria-label={isReply ? "Send reply" : "Send"}
          data-testid="entry-composer-submit"
        >
          <SendHorizonal className="h-4 w-4 text-white" />
        </button>
      </div>

      {/* Visible mention-chip row — surfaced for the test to find chips in the DOM. */}
      {mentions.length > 0 && (
        <div
          className="flex flex-wrap gap-1.5 mt-2 px-1"
          data-testid="entry-composer-mentions"
        >
          {mentions.map((m) => (
            <span
              key={`${m.type}-${m.id}`}
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                m.type === "agent"
                  ? "bg-violet-500/15 text-violet-300"
                  : "bg-slate-500/15 text-slate-300",
              )}
              data-testid={`mention-chip-${m.name}`}
            >
              @{m.name}
              <button
                type="button"
                onClick={() =>
                  setMentions((prev) => prev.filter((p) => !(p.id === m.id && p.type === m.type)))
                }
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove @${m.name}`}
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
