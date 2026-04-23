import { useState, useEffect, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { filesystemApi, type FsBrowseEntry } from "../api/filesystem";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Folder,
  FolderGit2,
  HardDrive,
  Home,
  ChevronUp,
  Monitor,
  Search,
  FolderPlus,
  Check,
  X,
  Loader2,
} from "lucide-react";

interface FolderBrowserDialogProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  title?: string;
  description?: string;
  gitAware?: boolean;
  initialPath?: string;
}

export function FolderBrowserDialog({
  open,
  onClose,
  onSelect,
  title = "Select Folder",
  description = "Choose a folder from your file system",
  gitAware = false,
  initialPath,
}: FolderBrowserDialogProps) {
  const [currentPath, setCurrentPath] = useState<string | undefined>(initialPath);
  const [manualPath, setManualPath] = useState("");
  const [filter, setFilter] = useState("");
  const [newFolderMode, setNewFolderMode] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showDrives, setShowDrives] = useState(false);
  const queryClient = useQueryClient();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentPath(initialPath);
      setManualPath("");
      setFilter("");
      setNewFolderMode(false);
      setNewFolderName("");
      setShowDrives(false);
    }
  }, [open, initialPath]);

  // Fetch home path once for the Home button
  const { data: homeData } = useQuery({
    queryKey: ["filesystem", "home"],
    queryFn: () => filesystemApi.home(),
    enabled: open,
    staleTime: Infinity,
  });

  // Fetch drives list (for Windows "go up from drive root" behavior)
  const { data: drivesData, isLoading: drivesLoading } = useQuery({
    queryKey: ["filesystem", "drives"],
    queryFn: () => filesystemApi.drives(),
    enabled: open && showDrives,
    staleTime: Infinity,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ["filesystem", "browse", currentPath, gitAware],
    queryFn: () => filesystemApi.browse(currentPath, { gitAware }),
    enabled: open,
    retry: false,
  });

  // Update manual path input when browsing
  useEffect(() => {
    if (data?.currentPath) {
      setManualPath(data.currentPath);
    }
  }, [data?.currentPath]);

  const filteredEntries = useMemo(() => {
    if (!data?.entries) return [];
    if (!filter) return data.entries;
    const lower = filter.toLowerCase();
    return data.entries.filter((e) => e.name.toLowerCase().includes(lower));
  }, [data?.entries, filter]);

  const handleGoToPath = useCallback(() => {
    if (manualPath.trim()) {
      setCurrentPath(manualPath.trim());
      setShowDrives(false);
      setFilter("");
    }
  }, [manualPath]);

  const handleNavigate = useCallback((entryPath: string) => {
    setCurrentPath(entryPath);
    setShowDrives(false);
    setFilter("");
  }, []);

  const isWindows = data?.platform === "win32" || homeData?.platform === "win32";
  const atDriveRoot = !data?.parentPath && !!data?.currentPath;

  const handleGoUp = useCallback(() => {
    if (showDrives) {
      // Already showing drives, nowhere to go
      return;
    }
    if (data?.parentPath) {
      setCurrentPath(data.parentPath);
      setFilter("");
    } else if (atDriveRoot && isWindows) {
      // At drive root on Windows — show drives list
      setShowDrives(true);
      setFilter("");
      setManualPath("");
    }
  }, [data?.parentPath, atDriveRoot, isWindows, showDrives]);

  const homePath = data?.homePath ?? homeData?.homePath;

  const handleGoHome = useCallback(() => {
    if (homePath) {
      setCurrentPath(homePath);
      setShowDrives(false);
      setFilter("");
    }
  }, [homePath]);

  const handleSelectCurrent = useCallback(() => {
    if (data?.currentPath) {
      onSelect(data.currentPath);
      onClose();
    }
  }, [data?.currentPath, onSelect, onClose]);

  const mkdirMutation = useMutation({
    mutationFn: (dirPath: string) => filesystemApi.mkdir(dirPath),
    onSuccess: () => {
      setNewFolderMode(false);
      setNewFolderName("");
      // Refresh the current directory listing
      queryClient.invalidateQueries({ queryKey: ["filesystem", "browse", currentPath] });
    },
  });

  const handleCreateFolder = useCallback(() => {
    if (!newFolderName.trim() || !data?.currentPath) return;
    const sep = data.currentPath.includes("\\") ? "\\" : "/";
    const newPath = data.currentPath + sep + newFolderName.trim();
    mkdirMutation.mutate(newPath);
  }, [newFolderName, data?.currentPath, mkdirMutation]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[560px] max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm">{description}</DialogDescription>
          <p className="text-xs text-muted-foreground mt-0.5">
            Click folder names to navigate &middot; Use action buttons to select
          </p>
        </DialogHeader>

        <div className="px-5 space-y-3">
          {/* Manual path entry */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Enter path manually:
            </label>
            <div className="flex gap-1.5">
              <Input
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/path/to/your/project"
                className="font-mono text-xs"
                onKeyDown={(e) => e.key === "Enter" && handleGoToPath()}
              />
              <Button size="sm" variant="secondary" onClick={handleGoToPath}>
                Go
              </Button>
            </div>
          </div>

          {/* Search current directory */}
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Search current directory:
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filter folders and files..."
                className="pl-8 text-xs"
              />
            </div>
          </div>

          {/* Navigation bar */}
          <div className="flex items-center gap-1.5">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              onClick={handleGoHome}
              title="Home directory"
            >
              <Home className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7 shrink-0"
              onClick={handleGoUp}
              disabled={showDrives || (!data?.parentPath && !isWindows) || (!data?.parentPath && !atDriveRoot)}
              title="Go up"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <span className="font-mono text-xs text-muted-foreground truncate min-w-0 flex-1 px-2 py-1 bg-muted/50 rounded flex items-center gap-1.5">
              {showDrives ? (
                <>
                  <Monitor className="h-3 w-3 shrink-0" />
                  This PC
                </>
              ) : (
                data?.currentPath ?? currentPath ?? "Loading..."
              )}
            </span>
            {!showDrives && (
              <Button size="sm" variant="secondary" onClick={handleSelectCurrent} className="shrink-0 text-xs">
                Select Current
              </Button>
            )}
          </div>
        </div>

        {/* Directory listing / Drives listing */}
        <div className="flex-1 min-h-0 overflow-y-auto mx-5 mt-2 mb-3 border rounded-md">
          {showDrives ? (
            drivesLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Detecting drives...
              </div>
            ) : drivesData?.drives.length ? (
              <div className="divide-y divide-border">
                {drivesData.drives.map((drive) => (
                  <button
                    key={drive.path}
                    type="button"
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left hover:bg-accent/50 transition-colors"
                    onClick={() => handleNavigate(drive.path)}
                  >
                    <HardDrive className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-mono">{drive.name}</span>
                    <span className="text-xs text-muted-foreground ml-1">{drive.path}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
                No drives detected
              </div>
            )
          ) : isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              Loading...
            </div>
          ) : error ? (
            <div className="flex items-center justify-center py-12 text-sm text-destructive px-4 text-center">
              {(error as Error).message || "Failed to read directory"}
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {filter ? "No matching folders" : "Empty directory"}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filteredEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-accent/50 transition-colors"
                  onClick={() => handleNavigate(entry.path)}
                >
                  {entry.isGitRepo ? (
                    <FolderGit2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.isGitRepo && (
                    <span className="ml-auto shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                      git repo
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* New folder inline input */}
        {newFolderMode && (
          <div className="mx-5 mb-2 flex items-center gap-1.5">
            <FolderPlus className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="New folder name"
              className="text-xs flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") {
                  setNewFolderMode(false);
                  setNewFolderName("");
                }
              }}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim() || mkdirMutation.isPending}
            >
              {mkdirMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => {
                setNewFolderMode(false);
                setNewFolderName("");
              }}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        <DialogFooter className="px-5 pb-5 pt-2 border-t flex items-center gap-2">
          {!showDrives && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewFolderMode(true)}
              disabled={newFolderMode}
              className="mr-auto"
            >
              <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
              New Folder
            </Button>
          )}
          {showDrives && <div className="mr-auto" />}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {!showDrives && (
            <Button onClick={handleSelectCurrent} disabled={!data?.currentPath}>
              Select Path
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
