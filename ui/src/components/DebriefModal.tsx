import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { debriefsApi } from "../api/debriefs";
import { projectsApi } from "../api/projects";
import { transcriptionApi } from "../api/transcription";
import { queryKeys } from "../lib/queryKeys";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Mic } from "lucide-react";
import { VoiceRecorder } from "./VoiceRecorder";

type TabValue = "paste" | "write" | "voice";

export function DebriefModal() {
  const { debriefOpen, closeDebrief } = useDialog();
  const { selectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<TabValue>("paste");
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [isPolling, setIsPolling] = useState(false);
  const [createdDebriefId, setCreatedDebriefId] = useState<string | null>(null);
  const [createdDiscussionId, setCreatedDiscussionId] = useState<string | null>(null);

  // Voice-specific state
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcription, setTranscription] = useState<string | null>(null);
  const [transcriptionEdited, setTranscriptionEdited] = useState("");
  const [lastRecordingBlob, setLastRecordingBlob] = useState<Blob | null>(null);
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [transcriptionRetries, setTranscriptionRetries] = useState(0);
  const MAX_TRANSCRIPTION_RETRIES = 3;

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && debriefOpen,
  });

  const departments = projects?.filter((p) => p.type === "department") ?? [];

  // Poll until extraction is complete
  useQuery({
    queryKey: ["debrief-poll", createdDebriefId],
    queryFn: async () => {
      if (!selectedCompanyId || !createdDebriefId) return null;
      const debrief = await debriefsApi.get(selectedCompanyId, createdDebriefId);
      if (debrief.status === "processing_failed") {
        throw new Error("Discussion processing failed");
      }
      if (debrief.status === "ready") {
        setIsPolling(false);
        resetAndClose();
        if (createdDiscussionId) {
          navigate(`/discussions/${createdDiscussionId}`);
        }
        return debrief;
      }
      return debrief;
    },
    enabled: isPolling && !!createdDebriefId && !!selectedCompanyId,
    refetchInterval: 2000,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      debriefsApi.create(selectedCompanyId!, data),
    onSuccess: (debrief: { id: string; discussionId?: string }) => {
      setCreatedDebriefId(debrief.id);
      if (debrief.discussionId) setCreatedDiscussionId(debrief.discussionId);
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId!) });
    },
    onError: () => {
      pushToast({ title: "Failed to create discussion", tone: "warn" });
    },
  });

  function resetAndClose() {
    setTab("paste");
    setContent("");
    setTitle("");
    setDepartmentId("");
    setIsPolling(false);
    setCreatedDebriefId(null);
    setCreatedDiscussionId(null);
    setAudioBlob(null);
    setIsTranscribing(false);
    setTranscription(null);
    setTranscriptionEdited("");
    setLastRecordingBlob(null);
    setTranscriptionError(null);
    setTranscriptionRetries(0);
    closeDebrief();
  }

  function handleSubmit() {
    if (!selectedCompanyId) return;

    if (tab === "voice") {
      // Submit the transcription text
      const voiceContent = transcriptionEdited.trim() || transcription?.trim();
      if (!voiceContent) return;
      createMutation.mutate({
        inputType: "voice",
        rawContent: voiceContent,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(departmentId ? { departmentId } : {}),
        sourceInfo: { transcriptionModel: "whisper-1" },
      });
    } else {
      if (!content.trim()) return;
      createMutation.mutate({
        inputType: tab,
        rawContent: content.trim(),
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(departmentId ? { departmentId } : {}),
      });
    }
  }

  async function handleRecordingComplete(blob: Blob, isRetry = false) {
    if (!isRetry) {
      // Fresh recording — reset retry count
      setLastRecordingBlob(blob);
      setTranscriptionRetries(0);
    }
    setAudioBlob(blob);
    setTranscriptionError(null);

    if (!selectedCompanyId) return;

    setIsTranscribing(true);
    try {
      const result = await transcriptionApi.transcribe(selectedCompanyId, blob);
      setTranscription(result.text);
      setTranscriptionEdited(result.text);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Transcription failed";
      setTranscriptionError(message);
      setTranscription(null);
    } finally {
      setIsTranscribing(false);
    }
  }

  async function retryTranscription() {
    if (!lastRecordingBlob || transcriptionRetries >= MAX_TRANSCRIPTION_RETRIES) return;
    setTranscriptionRetries((r) => r + 1);
    await handleRecordingComplete(lastRecordingBlob, true);
  }

  const isSubmitting = createMutation.isPending || isPolling;

  const voiceContent = transcriptionEdited.trim() || transcription?.trim();
  const canSubmit =
    tab === "voice"
      ? !!voiceContent && !isTranscribing
      : !!content.trim();

  return (
    <Dialog open={debriefOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent
        showCloseButton={!isSubmitting}
        className="sm:max-w-[600px] gap-0 flex flex-col"
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>New Discussion</DialogTitle>
        </DialogHeader>

        {isSubmitting ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing your discussion...</p>
            <p className="text-xs text-muted-foreground/60">
              Extracting decisions, tasks, insights, and context
            </p>
          </div>
        ) : (
          <div className="px-6 pb-6 flex flex-col gap-4">
            <Tabs value={tab} onValueChange={(v) => setTab(v as TabValue)}>
              <TabsList>
                <TabsTrigger value="paste">Paste / Import</TabsTrigger>
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
                  className="min-h-[200px] resize-y"
                />
              </TabsContent>
              <TabsContent value="write" className="mt-3">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your observations, decisions, ideas..."
                  className="min-h-[200px] resize-y"
                />
              </TabsContent>
              <TabsContent value="voice" className="mt-3">
                <div className="flex flex-col gap-3">
                  <VoiceRecorder
                    onRecordingComplete={handleRecordingComplete}
                    disabled={isTranscribing}
                  />

                  {isTranscribing && (
                    <div className="flex items-center gap-2 rounded-md bg-muted/50 p-4">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        Transcribing audio...
                      </span>
                    </div>
                  )}

                  {transcription !== null && !isTranscribing && (
                    <div className="flex flex-col gap-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Transcription (edit if needed)
                      </Label>
                      <Textarea
                        value={transcriptionEdited}
                        onChange={(e) => setTranscriptionEdited(e.target.value)}
                        className="min-h-[120px] resize-y"
                      />
                    </div>
                  )}

                  {transcriptionError && !isTranscribing && (
                    <div className="flex items-center gap-2 text-sm text-destructive">
                      <span>{transcriptionError}</span>
                      {transcriptionRetries < MAX_TRANSCRIPTION_RETRIES && (
                        <Button variant="outline" size="sm" onClick={retryTranscription}>
                          Retry ({MAX_TRANSCRIPTION_RETRIES - transcriptionRetries} left)
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="debrief-title" className="text-xs text-muted-foreground">
                  Title (optional — auto-generated if empty)
                </Label>
                <Input
                  id="debrief-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Q1 Planning Session Notes"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="debrief-dept" className="text-xs text-muted-foreground">
                  Department (optional)
                </Label>
                <select
                  id="debrief-dept"
                  value={departmentId}
                  onChange={(e) => setDepartmentId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">No department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || !selectedCompanyId}
              >
                Process Discussion
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
