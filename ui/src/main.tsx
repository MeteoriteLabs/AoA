import React, { StrictMode } from "react";
import ReactDOM from "react-dom";
import { createRoot } from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { CompanyProvider } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { BreadcrumbProviderWithCompany } from "./context/BreadcrumbContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { ToastProvider } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/toaster";
import { ToastProvider as MarketplaceToastProvider } from "@/components/marketplace/toast/ToastProvider";
import { InstallToastSlot } from "@/components/marketplace/toast/InstallToastSlot";
import { UnsavedChangesProvider } from "./context/UnsavedChangesProvider";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { initPluginBridge } from "./plugins/bridge-init";
import { runStorageMigrations } from "./lib/storage-migrations";
import "@mdxeditor/editor/style.css";
import "./index.css";

// Migrate legacy Paperclip localStorage keys to AoA names before any
// context provider reads from localStorage.
runStorageMigrations();

// Initialize plugin bridge before React renders
initPluginBridge(React, ReactDOM);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js");
  });
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

// Inner shell rendered as the data router's single catch-all element. The
// existing <Routes>/<Route> tree in <App/> rides along unchanged; mounting via
// createBrowserRouter (instead of <BrowserRouter>) is what unlocks the app-wide
// useBlocker inside UnsavedChangesProvider (validated by the /browse spike).
function RouterShell() {
  return (
    <TooltipProvider>
      <BreadcrumbProviderWithCompany>
        <SidebarProvider>
          <DialogProvider>
            <MarketplaceToastProvider>
              <UnsavedChangesProvider>
                <ErrorBoundary>
                  <App />
                </ErrorBoundary>
                <InstallToastSlot />
                <Toaster />
              </UnsavedChangesProvider>
            </MarketplaceToastProvider>
          </DialogProvider>
        </SidebarProvider>
      </BreadcrumbProviderWithCompany>
    </TooltipProvider>
  );
}

const router = createBrowserRouter([{ path: "*", element: <RouterShell /> }]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CompanyProvider>
          <ToastProvider>
            <LiveUpdatesProvider>
              <RouterProvider router={router} />
            </LiveUpdatesProvider>
          </ToastProvider>
        </CompanyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>
);
