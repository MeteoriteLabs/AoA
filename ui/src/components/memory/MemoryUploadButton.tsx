import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { memoryAssetsApi } from "../../api/memoryAssets";
import { queryKeys } from "../../lib/queryKeys";
import { useToast } from "../../context/ToastContext";

interface MemoryUploadButtonProps {
  companyId: string;
  departmentId: string | null;
  folderPath: string;
}

export function MemoryUploadButton({
  companyId,
  departmentId,
  folderPath,
}: MemoryUploadButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const { pushToast } = useToast();

  const uploadMutation = useMutation({
    mutationFn: (file: File) =>
      memoryAssetsApi.upload(companyId, file, {
        departmentId: departmentId ?? undefined,
        folderPath: folderPath || undefined,
      }),
    onSuccess: (res) => {
      pushToast({
        title: `Uploaded ${res.asset.fileName} — extraction queued`,
        tone: "success",
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.memory.assets.list(companyId, {
          departmentId: departmentId ?? undefined,
          folderPath,
        }),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.memory.assets.list(companyId),
      });
    },
    onError: (err) =>
      pushToast({
        title: err instanceof Error ? err.message : "Upload failed",
        tone: "error",
      }),
  });

  function handlePick() {
    fileInputRef.current?.click();
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      uploadMutation.mutate(f);
      e.target.value = "";
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={handlePick}
        disabled={uploadMutation.isPending}
        className="h-7 gap-1 text-xs"
      >
        {uploadMutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Upload className="h-3 w-3" />
        )}
        Upload
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        hidden
        onChange={handleChange}
        accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.mov,.pptx"
      />
    </>
  );
}
