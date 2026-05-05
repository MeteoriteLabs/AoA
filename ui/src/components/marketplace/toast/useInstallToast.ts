import { useContext } from "react";
import { ToastContext } from "./ToastProvider";

export function useInstallToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useInstallToast must be used within <ToastProvider>");
  return ctx;
}
