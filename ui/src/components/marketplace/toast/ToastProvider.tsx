import { createContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useOperationStatus } from "@/hooks/useOperationStatus";

export interface ToastState {
  id: number;
  status: "installing" | "success" | "failure";
  message: string;
  detail?: string;
  actionLabel?: string;
  actionTo?: string;
}

interface ToastContextValue {
  toast: ToastState | null;
  show: (toast: Omit<ToastState, "id">) => number;
  update: (id: number, patch: Partial<Omit<ToastState, "id">>) => void;
  trackOperation: (operation: InstallToastOperation) => void;
  dismiss: () => void;
}

export interface InstallToastOperation {
  toastId: number;
  companyId: string;
  operationId: string;
  itemName: string;
  successMessage?: string;
  requestedMessage?: string;
  failureMessage?: string;
  invalidate?: "plugins" | "companySkills";
  startedAfter?: Date;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [trackedOperation, setTrackedOperation] = useState<InstallToastOperation | null>(null);
  const queryClient = useQueryClient();

  const { data: operationStatus } = useOperationStatus({
    companyId: trackedOperation?.companyId ?? null,
    operationId: trackedOperation?.operationId ?? null,
    startedAfter: trackedOperation?.startedAfter,
  });

  const show = useCallback((next: Omit<ToastState, "id">) => {
    const id = nextId++;
    setToast({ id, ...next });
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Omit<ToastState, "id">>) => {
    setToast((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const trackOperation = useCallback((operation: InstallToastOperation) => {
    setTrackedOperation(operation);
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  useEffect(() => {
    if (!trackedOperation || !operationStatus) return;
    if (operationStatus.status === "success") {
      update(trackedOperation.toastId, {
        status: "success",
        message: trackedOperation.successMessage ?? `Installed ${trackedOperation.itemName}`,
      });
    } else if (operationStatus.status === "requested") {
      update(trackedOperation.toastId, {
        status: "success",
        message:
          trackedOperation.requestedMessage ??
          `Request submitted - a founder will review ${trackedOperation.itemName}`,
      });
    } else if (operationStatus.status === "failure") {
      update(trackedOperation.toastId, {
        status: "failure",
        message: trackedOperation.failureMessage ?? `Failed to install ${trackedOperation.itemName}`,
        detail: operationStatus.errorMessage ?? "Unknown error",
      });
    } else {
      return;
    }

    if (trackedOperation.invalidate === "plugins") {
      void queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    } else if (trackedOperation.invalidate === "companySkills") {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.companySkills.list(trackedOperation.companyId),
      });
    }
    setTrackedOperation(null);
  }, [operationStatus, queryClient, trackedOperation, update]);

  // Auto-dismiss success/failure after 3s
  useEffect(() => {
    if (!toast) return;
    if (toast.status === "installing") return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast, show, update, trackOperation, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}
