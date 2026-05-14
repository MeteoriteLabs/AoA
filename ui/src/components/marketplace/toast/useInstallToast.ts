import { useContext } from "react";
import { ToastContext } from "./ToastProvider";

// No-op fallback used when a modal is mounted outside a ToastProvider
// (e.g. CatalogCard rendered without the app shell's provider in tests).
// Toast display and operation tracking silently no-op in that test-only path.
const NOOP_CONTEXT = {
  toast: null as null,
  show: () => 0,
  update: () => {},
  trackOperation: () => {},
  dismiss: () => {},
};

export function useInstallToast() {
  const ctx = useContext(ToastContext);
  return ctx ?? NOOP_CONTEXT;
}
