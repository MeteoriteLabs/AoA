import { Link } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, X } from "lucide-react";
import { useInstallToast } from "./useInstallToast";

/**
 * Global render slot for the marketplace install toast.
 * Mount once at app root (after BrowserRouter so Link works).
 * Reads state from ToastContext via useInstallToast().
 */
export function InstallToastSlot() {
  const { toast, dismiss } = useInstallToast();
  if (!toast) return null;

  const Icon =
    toast.status === "installing" ? Loader2
    : toast.status === "success" ? CheckCircle2
    : XCircle;

  const colorClass =
    toast.status === "installing" ? "text-blue-600"
    : toast.status === "success" ? "text-green-600"
    : "text-red-600";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 bg-background border rounded-lg shadow-lg p-4 max-w-sm flex items-start gap-3"
    >
      <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${colorClass} ${toast.status === "installing" ? "animate-spin" : ""}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.message}</p>
        {toast.detail && <p className="text-xs text-muted-foreground mt-1">{toast.detail}</p>}
        {toast.status === "success" && toast.actionLabel && toast.actionTo && (
          <Link
            to={toast.actionTo}
            className="text-xs text-primary hover:underline mt-2 inline-block"
            onClick={dismiss}
          >
            {toast.actionLabel} →
          </Link>
        )}
      </div>
      <button onClick={dismiss} aria-label="Dismiss notification" className="shrink-0 text-muted-foreground hover:text-foreground">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
