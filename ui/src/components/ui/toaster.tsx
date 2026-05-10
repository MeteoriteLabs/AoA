"use client";
import { Toaster as Sonner } from "sonner";

export function Toaster() {
  return (
    <Sonner
      position="top-right"
      theme="dark"
      duration={4000}
      closeButton
      toastOptions={{
        className:
          "!bg-card-2 !border !border-border !rounded-lg !shadow-[0_4px_12px_rgba(0,0,0,0.35),0_16px_36px_rgba(0,0,0,0.25)]",
        classNames: {
          title: "!text-sm !font-semibold !text-text",
          description: "!text-xs !text-dim",
          success: "!border-l-[3px] !border-l-success",
          error: "!border-l-[3px] !border-l-error",
          warning: "!border-l-[3px] !border-l-warning",
          info: "!border-l-[3px] !border-l-info",
          actionButton: "!bg-brand !text-white !text-xs !font-semibold !rounded-md !px-2 !py-1",
          cancelButton: "!bg-card !border !border-border !text-text !text-xs !rounded-md !px-2 !py-1",
        },
      }}
    />
  );
}
