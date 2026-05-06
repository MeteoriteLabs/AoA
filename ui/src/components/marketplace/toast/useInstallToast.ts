import { useContext } from "react";
import { ToastContext } from "./ToastProvider";

// No-op fallback used when the modal is mounted outside a ToastProvider
// (e.g. CatalogCard rendered without the app shell's provider in tests).
// The modal's polling state still works correctly — toasts just silently no-op.
const NOOP_CONTEXT = {
  toast: null as null,
  show: () => -1,
  update: () => {},
  dismiss: () => {},
};

export function useInstallToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP_CONTEXT;
}
