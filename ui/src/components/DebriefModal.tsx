import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@/lib/router";
import { useDialog } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { useToast } from "../context/ToastContext";
import { debriefsApi } from "../api/debriefs";
import { briefsApi } from "../api/briefs";
import { projectsApi } from "../api/projects";
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
import { Loader2 } from "lucide-react";

type TabValue = "paste" | "write";

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

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && debriefOpen,
  });

  const departments = projects?.filter((p) => p.type === "department") ?? [];

  // Poll for briefs once a debrief is submitted
  useQuery({
    queryKey: ["debrief-poll", createdDebriefId],
    queryFn: async () => {
      if (!selectedCompanyId || !createdDebriefId) return null;
      const debrief = await debriefsApi.get(selectedCompanyId, createdDebriefId);
      if (debrief.status === "processing_failed") {
        throw new Error("Debrief processing failed");
      }
      if (debrief.status === "ready") {
        // Fetch briefs for this debrief to get the brief ID
        const allBriefs = await briefsApi.list(selectedCompanyId);
        const brief = allBriefs.find((b) => b.debriefId === createdDebriefId);
        if (brief) {
          setIsPolling(false);
          resetAndClose();
          navigate(`/briefs/${brief.id}`);
          return brief;
        }
      }
      return debrief;
    },
    enabled: isPolling && !!createdDebriefId && !!selectedCompanyId,
    refetchInterval: 2000,
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      debriefsApi.create(selectedCompanyId!, data),
    onSuccess: (debrief) => {
      setCreatedDebriefId(debrief.id);
      setIsPolling(true);
      queryClient.invalidateQueries({ queryKey: queryKeys.activity(selectedCompanyId!) });
    },
    onError: () => {
      pushToast({ title: "Failed to create debrief", tone: "warn" });
    },
  });

  function resetAndClose() {
    setTab("paste");
    setContent("");
    setTitle("");
    setDepartmentId("");
    setIsPolling(false);
    setCreatedDebriefId(null);
    closeDebrief();
  }

  function handleSubmit() {
    if (!content.trim()) return;
    createMutation.mutate({
      inputType: tab,
      rawContent: content.trim(),
      ...(title.trim() ? { title: title.trim() } : {}),
      ...(departmentId ? { departmentId } : {}),
    });
  }

  const isSubmitting = createMutation.isPending || isPolling;

  return (
    <Dialog open={debriefOpen} onOpenChange={(open) => { if (!open) resetAndClose(); }}>
      <DialogContent
        showCloseButton={!isSubmitting}
        className="sm:max-w-[600px] gap-0 flex flex-col"
      >
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle>New Debrief</DialogTitle>
        </DialogHeader>

        {isSubmitting ? (
          <div className="flex flex-col items-center justify-center gap-3 py-12 px-6">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Processing your debrief...</p>
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
                onClick={handleSubmit}
                disabled={!content.trim()}
              >
                Process Debrief
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
