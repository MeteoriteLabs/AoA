import { toast as sonnerToast } from "sonner";

interface ToastOptions {
  description?: string;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

export const toast = {
  success: (title: string, options?: ToastOptions) =>
    sonnerToast.success(title, options),
  error: (title: string, options?: ToastOptions) =>
    sonnerToast.error(title, { duration: 8000, ...options }),
  warning: (title: string, options?: ToastOptions) =>
    sonnerToast.warning(title, options),
  info: (title: string, options?: ToastOptions) =>
    sonnerToast.info(title, options),
  message: (title: string, options?: ToastOptions) =>
    sonnerToast(title, options),
  dismiss: (id?: string | number) => sonnerToast.dismiss(id),
};

export type Toast = typeof toast;
