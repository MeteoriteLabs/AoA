import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { uploadFileArtifact, type ArtifactSummary } from "../../api/artifacts";
import { ApiError } from "../../api/client";
import { useToast } from "../../context/ToastContext";

interface FileArtifactUploadProps {
  companyId: string;
  type?: string;
  onUploaded: (artifact: ArtifactSummary) => void;
  disabled?: boolean;
}

export function FileArtifactUpload({ companyId, type = "document", onUploaded, disabled }: FileArtifactUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { pushToast } = useToast();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const artifact = await uploadFileArtifact(companyId, file, { title: file.name, type });
      onUploaded(artifact);
    } catch (err) {
      // Surface upload failures the same way the sibling paperclip flow does
      // (don't leave a silent unhandled rejection — the button would just snap
      // back from "Uploading…" with no feedback).
      pushToast({ title: err instanceof ApiError ? err.message : "Couldn't upload file artifact", tone: "error" });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" className="hidden" onChange={onPick} data-testid="file-artifact-input" aria-label="Attach a file as a tracked artifact" />
      <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
        data-testid="file-artifact-upload" title="Attach a file as a tracked artifact" aria-label="Attach a file as a tracked artifact">
        <Paperclip className="h-3 w-3" aria-hidden="true" />
        {busy ? "Uploading…" : "File artifact"}
      </button>
    </>
  );
}
