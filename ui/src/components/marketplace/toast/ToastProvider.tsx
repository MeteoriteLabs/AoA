import { createContext, useState, useCallback, useEffect, type ReactNode } from "react";

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
  dismiss: () => void;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const show = useCallback((next: Omit<ToastState, "id">) => {
    const id = nextId++;
    setToast({ id, ...next });
    return id;
  }, []);

  const update = useCallback((id: number, patch: Partial<Omit<ToastState, "id">>) => {
    setToast((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  // Auto-dismiss success/failure after 3s
  useEffect(() => {
    if (!toast) return;
    if (toast.status === "installing") return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={{ toast, show, update, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}
