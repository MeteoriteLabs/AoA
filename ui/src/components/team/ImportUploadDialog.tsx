import { useState, useRef } from "react";
import { Upload } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { teamsApi, type TeamImportPreview } from "../../api/teams";
import { useCompany } from "../../context/CompanyContext";
import { useToast } from "../../context/ToastContext";
import { ImportPreviewDialog } from "./ImportPreviewDialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Slice 8 / Task 8.4: First step of the import flow. Founder picks a
 * `.team.yaml` file (drag/drop or browse). On success we hand off to
 * `ImportPreviewDialog`, which renders the diff + collision resolver and
 * triggers the actual install. We hold onto the raw YAML so the install
 * call can replay it server-side without a second upload.
 */
export function ImportUploadDialog({ open, onOpenChange }: Props) {
  const { selectedCompanyId } = useCompany();
  const { pushToast } = useToast();
  const [yamlContent, setYamlContent] = useState<string | null>(null);
  const [preview, setPreview] = useState<TeamImportPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (!selectedCompanyId) return;
    setLoading(true);
    try {
      // Read the YAML once on the client so we can both submit it for
      // preview AND replay it on install — no second upload required.
      const text = await file.text();
      setYamlContent(text);
      const result = await teamsApi.previewImport(selectedCompanyId, file);
      setPreview(result);
    } catch (err) {
      pushToast({
        title: "Import failed",
        body: (err as Error).message,
        tone: "error",
      });
      setYamlContent(null);
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }

  function handleDialogChange(next: boolean) {
    onOpenChange(next);
    if (!next) {
      // Drop preview state when the dialog closes so the next open
      // starts at the upload step.
      setYamlContent(null);
      setPreview(null);
      setLoading(false);
    }
  }

  // Once the preview is loaded, swap in the preview dialog. Closing the
  // preview dialog flows back through `handleDialogChange` and resets us.
  if (preview && yamlContent) {
    return (
      <ImportPreviewDialog
        open={open}
        onOpenChange={handleDialogChange}
        preview={preview}
        yamlContent={yamlContent}
      />
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import team from file</DialogTitle>
          <DialogDescription>Upload a .team.yaml package.</DialogDescription>
        </DialogHeader>

        <div
          className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-9 text-center"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void handleFile(f);
          }}
        >
          <Upload
            className="mx-auto h-8 w-8 text-muted-foreground"
            aria-hidden="true"
          />
          <p className="mt-2 text-sm font-bold">Drag a team file here</p>
          <p className="text-xs text-muted-foreground">or</p>
          <Button
            onClick={() => fileRef.current?.click()}
            className="mt-3"
            disabled={loading}
          >
            {loading ? "Parsing…" : "Browse files"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".yaml,.yml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <p className="mt-3 text-[10px] text-muted-foreground">
            .yaml · .yml · max 5MB
          </p>
        </div>

        <p className="text-xs text-muted-foreground">
          The file is parsed and you'll get a preview before anything is
          written.
        </p>
      </DialogContent>
    </Dialog>
  );
}
