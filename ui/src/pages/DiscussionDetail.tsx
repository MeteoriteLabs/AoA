import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "@/lib/router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { discussionsApi, type DiscussionEntry, type ExtractedItem } from "../api/discussions";
import { projectsApi } from "../api/projects";
import { transcriptionApi } from "../api/transcription";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ClipboardPen,
  Loader2,
  MessageSquare,
  Mic,
  Pencil,
  PenLine,
  Plug,
  RefreshCw,
  Send,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "../lib/utils";
import { VoiceRecorder } from "../components/VoiceRecorder";

type InputTab = "paste" | "write" | "voice";

const SOURCE_ICONS: Record<string, typeof ClipboardPen> = {
  paste: ClipboardPen,
  write: PenLine,
  voice: Mic,
  mcp: Plug,
};

const SOURCE_LABELS: Record<string, string> = {
  paste: "Paste",
  write: "Write",
  voice: "Voice",
  mcp: "MCP",
};

const TYPE_COLORS: Record<string, string> = {
  decision: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
  task: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  insight: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  context: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  reference: "bg-stone-200 text-stone-800 dark:bg-stone-800/30 dark:text-stone-300",
  preference: "bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300",
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  high: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  medium: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  low: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300",
};

const MEMORY_TYPES = new Set(["decision", "insight", "context", "reference", "preference"]);

function humanLayer(layer: string | null | undefined) {
  return (layer ?? "domain").replace("_", " ");
}

export function DiscussionDetail() {
  const { discussionId } = useParams<{ discussionId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs, setSubtitle, setEntityColor } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const { data: discussion, isLoading } = useQuery({
    queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
    queryFn: () => discussionsApi.get(selectedCompanyId!, discussionId!),
    enabled: !!selectedCompanyId && !!discussionId,
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: "Discussions", href: "/discussions" },
      { label: discussion?.title ?? "Discussion" },
    ]);
    setEntityColor("var(--entity-brief)");
    return () => { setSubtitle(null); setEntityColor(null); };
  }, [discussion?.title, setBreadcrumbs, setSubtitle, setEntityColor]);

  // Subtitle with pending count
  useEffect(() => {
    if (!discussion) return;
    setSubtitle(
      discussion.pendingItemCount > 0
        ? `${discussion.pendingItemCount} items pending`
        : null,
    );
  }, [discussion, setSubtitle]);

  // All pending item IDs across all entries
  const allPendingItemIds = useMemo(() => {
    if (!discussion) return [];
    return discussion.entries.flatMap((e) =>
      e.extractedItems.filter((i) => i.status === "pending").map((i) => i.id),
    );
  }, [discussion]);

  // Approve all pending items
  const approveMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      discussionsApi.approveItems(selectedCompanyId!, discussionId!, {
        items: itemIds.map((id) => ({ itemId: id, action: "approved" as const })),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.list(selectedCompanyId!),
      });
      pushToast({
        title: "Items approved",
        body: `${result.tasksCreated.length} tasks, ${result.memoryItemsCreated.length} memory items created`,
        tone: "success",
      });
    },
    onError: () => {
      pushToast({ title: "Failed to approve items", tone: "warn" });
    },
  });

  // Reject items
  const rejectMutation = useMutation({
    mutationFn: (itemIds: string[]) =>
      discussionsApi.rejectItems(selectedCompanyId!, discussionId!, itemIds),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.list(selectedCompanyId!),
      });
    },
    onError: () => {
      pushToast({ title: "Failed to reject items", tone: "warn" });
    },
  });

  // Reprocess entry
  const reprocessMutation = useMutation({
    mutationFn: (entryId: string) =>
      discussionsApi.reprocessEntry(selectedCompanyId!, discussionId!, entryId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
      });
      pushToast({ title: "Reprocessing entry...", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to reprocess entry", tone: "warn" });
    },
  });

  // Update item
  const updateItemMutation = useMutation({
    mutationFn: ({
      entryId,
      itemId,
      data,
    }: {
      entryId: string;
      itemId: string;
      data: Record<string, unknown>;
    }) => discussionsApi.updateItem(selectedCompanyId!, discussionId!, entryId, itemId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
      });
    },
    onError: () => {
      pushToast({ title: "Failed to update item", tone: "warn" });
    },
  });

  // Add entry
  const addEntryMutation = useMutation({
    mutationFn: (data: { inputType: string; rawContent: string; title?: string }) =>
      discussionsApi.addEntry(selectedCompanyId!, discussionId!, data as any),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.detail(selectedCompanyId!, discussionId!),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.discussions.list(selectedCompanyId!),
      });
      pushToast({ title: "Entry added — processing...", tone: "success" });
    },
    onError: () => {
      pushToast({ title: "Failed to add entry", tone: "warn" });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!discussion) {
    return (
      <div className="flex flex-col items-center gap-3 py-20">
        <p className="text-sm text-muted-foreground">Discussion not found</p>
        <Link to="/discussions" className="text-sm text-blue-600 hover:underline">
          Back to Discussions
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{discussion.title}</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {discussion.entryCount} {discussion.entryCount === 1 ? "entry" : "entries"}
            </span>
            {discussion.scopeName && (
              <Badge variant="outline" className="text-[10px]">
                {discussion.scopeName}
              </Badge>
            )}
            {discussion.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px]">
                {tag}
              </Badge>
            ))}
            <Badge
              variant="outline"
              className={cn(
                "text-[10px]",
                discussion.status === "archived" && "opacity-60",
              )}
            >
              {discussion.status}
            </Badge>
          </div>
        </div>
        {allPendingItemIds.length > 0 && (
          <Button
            size="sm"
            onClick={() => approveMutation.mutate(allPendingItemIds)}
            disabled={approveMutation.isPending}
          >
            {approveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <CheckCheck className="h-4 w-4 mr-1.5" />
            )}
            Confirm All ({allPendingItemIds.length})
          </Button>
        )}
      </div>

      {/* Entries thread */}
      <div className="space-y-4">
        {discussion.entries.map((entry) => (
          <EntryCard
            key={entry.id}
            entry={entry}
            onReprocess={() => reprocessMutation.mutate(entry.id)}
            onUpdateItem={(itemId, data) =>
              updateItemMutation.mutate({ entryId: entry.id, itemId, data })
            }
            onApproveItem={(itemId) =>
              approveMutation.mutate([itemId])
            }
            onRejectItem={(itemId) =>
              rejectMutation.mutate([itemId])
            }
            isReprocessing={reprocessMutation.isPending && reprocessMutation.variables === entry.id}
          />
        ))}
      </div>

      {/* Add entry input bar */}
      <AddEntryBar
        onSubmit={(inputType, rawContent) =>
          addEntryMutation.mutate({ inputType, rawContent })
        }
        isSubmitting={addEntryMutation.isPending}
        companyId={selectedCompanyId!}
      />
    </div>
  );
}

/* ─── Entry Card ─── */

function EntryCard({
  entry,
  onReprocess,
  onUpdateItem,
  onApproveItem,
  onRejectItem,
  isReprocessing,
}: {
  entry: DiscussionEntry;
  onReprocess: () => void;
  onUpdateItem: (itemId: string, data: Record<string, unknown>) => void;
  onApproveItem: (itemId: string) => void;
  onRejectItem: (itemId: string) => void;
  isReprocessing: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const SourceIcon = SOURCE_ICONS[entry.inputType] ?? MessageSquare;
  const sourceLabel = SOURCE_LABELS[entry.inputType] ?? entry.inputType;

  const pendingItems = entry.extractedItems.filter((i) => i.status === "pending");
  const approvedItems = entry.extractedItems.filter((i) => i.status === "approved" || i.status === "edited");
  const rejectedItems = entry.extractedItems.filter((i) => i.status === "rejected");

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Entry header */}
      <div className="flex items-center justify-between gap-2 p-4 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <button onClick={() => setExpanded((e) => !e)} className="shrink-0">
            {expanded ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          <SourceIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">{sourceLabel}</span>
          <span className="text-xs text-muted-foreground">
            {new Date(entry.createdAt).toLocaleString()}
          </span>
          <ExtractionStatusBadge status={entry.extractionStatus} />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onReprocess}
          disabled={isReprocessing || entry.extractionStatus === "processing"}
          className="shrink-0"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 mr-1", isReprocessing && "animate-spin")} />
          Reprocess
        </Button>
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Raw content */}
          <div className="rounded-md bg-muted/30 p-3">
            <p className="text-sm whitespace-pre-wrap text-muted-foreground leading-relaxed">
              {entry.rawContent}
            </p>
          </div>

          {/* Extracted items */}
          {entry.extractedItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Extracted Items ({entry.extractedItems.length})
              </p>

              {/* Pending items */}
              {pendingItems.map((item) => (
                <ExtractedItemCard
                  key={item.id}
                  item={item}
                  onUpdate={(data) => onUpdateItem(item.id, data)}
                  onApprove={() => onApproveItem(item.id)}
                  onReject={() => onRejectItem(item.id)}
                />
              ))}

              {/* Approved items */}
              {approvedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50/70 dark:border-green-800 dark:bg-green-950/30 p-3"
                >
                  <Check className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-sm">{item.title}</span>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
                    )}
                  >
                    {item.type}
                  </span>
                  {item.resultTaskId && (
                    <Link
                      to={`/issues?selected=${item.resultTaskId}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      View Task
                    </Link>
                  )}
                </div>
              ))}

              {/* Rejected items */}
              {rejectedItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md border border-border p-3 opacity-50"
                >
                  <XCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="text-sm line-through text-muted-foreground">{item.title}</span>
                  <span className="text-[10px] text-muted-foreground uppercase">{item.type}</span>
                </div>
              ))}
            </div>
          )}

          {/* Processing indicator */}
          {entry.extractionStatus === "processing" && (
            <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Extracting items...</span>
            </div>
          )}

          {entry.extractionStatus === "failed" && (
            <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-950/30 p-3">
              <XCircle className="h-4 w-4 text-red-600" />
              <span className="text-sm text-red-700 dark:text-red-400">
                Extraction failed — try reprocessing
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Extraction Status Badge ─── */

function ExtractionStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
    completed: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
    failed: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
        styles[status] ?? styles.pending,
      )}
    >
      {status === "processing" && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
      {status}
    </span>
  );
}

/* ─── Extracted Item Card ─── */

function ExtractedItemCard({
  item,
  onUpdate,
  onApprove,
  onReject,
}: {
  item: ExtractedItem;
  onUpdate: (data: Record<string, unknown>) => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(item.title);
  const [editDescription, setEditDescription] = useState(item.description ?? "");
  const [editPriority, setEditPriority] = useState(item.suggestedPriority ?? "medium");
  const isMemoryType = MEMORY_TYPES.has(item.type);
  const effectiveLayer = item.layer ?? item.suggestedLayer ?? "domain";

  function saveEdit() {
    onUpdate({
      status: "edited",
      title: editTitle,
      description: editDescription,
      ...(item.type === "task" ? { suggestedPriority: editPriority } : {}),
    });
    setEditing(false);
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 space-y-2">
      {editing ? (
        <div className="space-y-2">
          <Input
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            className="text-sm font-medium"
          />
          <Textarea
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            className="min-h-[80px] text-sm resize-y"
          />
          {item.type === "task" && (
            <select
              value={editPriority}
              onChange={(e) => setEditPriority(e.target.value)}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={saveEdit}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <Checkbox
                checked={false}
                onCheckedChange={() => onApprove()}
              />
              <span className="text-sm font-medium">{item.title}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                  TYPE_COLORS[item.type] ?? "bg-muted text-muted-foreground",
                )}
              >
                {item.type}
              </span>
              {item.type === "task" && item.suggestedPriority && (
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                    PRIORITY_COLORS[item.suggestedPriority] ?? "bg-muted text-muted-foreground",
                  )}
                >
                  {item.suggestedPriority}
                </span>
              )}
              {isMemoryType && (
                <Badge variant="outline" className="text-[10px]">
                  {humanLayer(effectiveLayer)}
                </Badge>
              )}
              {item.conflictsWith && (
                <Badge variant="destructive" className="text-[10px]">
                  Conflict
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => {
                  setEditTitle(item.title);
                  setEditDescription(item.description ?? "");
                  setEditPriority(item.suggestedPriority ?? "medium");
                  setEditing(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={onReject}>
                <X className="h-3.5 w-3.5 text-red-500" />
              </Button>
            </div>
          </div>
          {item.description && (
            <p className="text-xs text-muted-foreground pl-7">{item.description}</p>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Add Entry Bar ─── */

function AddEntryBar({
  onSubmit,
  isSubmitting,
  companyId,
}: {
  onSubmit: (inputType: string, rawContent: string) => void;
  isSubmitting: boolean;
  companyId: string;
}) {
  const [tab, setTab] = useState<InputTab>("write");
  const [content, setContent] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcriptionEdited, setTranscriptionEdited] = useState("");

  function handleSubmit() {
    if (tab === "voice") {
      const voiceContent = transcriptionEdited.trim() || transcription?.trim();
      if (!voiceContent) return;
      onSubmit("voice", voiceContent);
      setTranscription(null);
      setTranscriptionEdited("");
    } else {
      if (!content.trim()) return;
      onSubmit(tab, content.trim());
      setContent("");
    }
  }

  async function handleRecordingComplete(blob: Blob) {
    setIsTranscribing(true);
    try {
      const result = await transcriptionApi.transcribe(companyId, blob);
      setTranscription(result.text);
      setTranscriptionEdited(result.text);
    } catch {
      setTranscription(null);
    } finally {
      setIsTranscribing(false);
    }
  }

  const canSubmit =
    tab === "voice"
      ? !!(transcriptionEdited.trim() || transcription?.trim()) && !isTranscribing
      : !!content.trim();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Add Entry
      </p>
      <Tabs value={tab} onValueChange={(v) => setTab(v as InputTab)}>
        <TabsList>
          <TabsTrigger value="paste">Paste</TabsTrigger>
          <TabsTrigger value="write">Write</TabsTrigger>
          <TabsTrigger value="voice" className="gap-1.5">
            <Mic className="h-3.5 w-3.5" />
            Voice
          </TabsTrigger>
        </TabsList>
        <TabsContent value="paste" className="mt-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Paste meeting notes, research, conversation transcripts..."
            className="min-h-[120px] resize-y"
          />
        </TabsContent>
        <TabsContent value="write" className="mt-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write your observations, decisions, ideas..."
            className="min-h-[120px] resize-y"
          />
        </TabsContent>
        <TabsContent value="voice" className="mt-3">
          <div className="flex flex-col gap-3">
            <VoiceRecorder onRecordingComplete={handleRecordingComplete} disabled={isTranscribing} />
            {isTranscribing && (
              <div className="flex items-center gap-2 rounded-md bg-muted/50 p-3">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Transcribing...</span>
              </div>
            )}
            {transcription !== null && !isTranscribing && (
              <Textarea
                value={transcriptionEdited}
                onChange={(e) => setTranscriptionEdited(e.target.value)}
                className="min-h-[80px] resize-y text-sm"
              />
            )}
          </div>
        </TabsContent>
      </Tabs>
      <div className="flex justify-end">
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!canSubmit || isSubmitting}
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Send className="h-4 w-4 mr-1.5" />
          )}
          Add Entry
        </Button>
      </div>
    </div>
  );
}
