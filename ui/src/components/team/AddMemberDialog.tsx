import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, TeamMemberSummary, UserRole } from "@armyofagents/shared";
import { accessApi } from "../../api/access";
import { teamApi } from "../../api/team";
import { queryKeys } from "../../lib/queryKeys";
import { formatInviteExpiry, toAbsoluteInviteUrl } from "../../lib/invite-expiry";
import { useToast } from "../../context/ToastContext";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface AddMemberDialogProps {
  companyId: string;
  departments: Project[];
  members: TeamMemberSummary[];
  isSystemAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddMemberDialog({
  companyId,
  departments,
  members,
  isSystemAdmin,
  open,
  onOpenChange,
}: AddMemberDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [mode, setMode] = useState<"direct" | "invite">("direct");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("team_member");
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [reportsToId, setReportsToId] = useState<string>("none");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const departmentOptions = useMemo(
    () => departments.filter((d) => d.type === "department"),
    [departments],
  );

  const reportsToOptions = useMemo(
    () => members.filter((m) => m.role !== "team_member"),
    [members],
  );

  const addMemberMutation = useMutation({
    mutationFn: () =>
      teamApi.addMember(companyId, {
        name: name.trim(),
        email: email.trim(),
        role,
        projectId: role === "founder" ? null : (departmentId !== "none" ? departmentId : null),
        parentType: reportsToId !== "none" ? "user" : null,
        parentId: reportsToId !== "none" ? reportsToId : null,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(companyId) });
      pushToast({ title: "Team member added", body: `${name.trim()} (${email.trim()})`, tone: "success" });
      onOpenChange(false);
      reset();
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to add member", body: err.message, tone: "error" });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createCompanyInvite(companyId, {
        allowedJoinTypes: "human",
        defaultsPayload: {
          human: {
            grants:
              role === "team_lead"
                ? [
                    { permissionKey: "tasks:assign" },
                    ...(departmentId !== "none"
                      ? [{ permissionKey: "tasks:assign_scope", scope: { projectId: departmentId } }]
                      : []),
                  ]
                : [],
          },
          teamInvite: {
            email: email.trim(),
            role,
            projectId: departmentId !== "none" ? departmentId : null,
            parentId: reportsToId !== "none" ? reportsToId : null,
          },
        },
      }),
    onSuccess: async (result) => {
      // Server returns an absolute URL; prefix the origin if a relative
      // path ever slips through so the copied link still works.
      const absoluteUrl = toAbsoluteInviteUrl(result.inviteUrl);
      setInviteUrl(absoluteUrl);
      setInviteExpiresAt(result.expiresAt ?? null);
      // Auto-copy so the founder can paste immediately; clipboard access can
      // be denied outside secure contexts — the manual Copy button remains.
      try {
        await navigator.clipboard.writeText(absoluteUrl);
        setCopied(true);
      } catch {
        setCopied(false);
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(companyId) });
      pushToast({ title: "Invite link created", body: email.trim(), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: "Failed to create invite", body: err.message, tone: "error" });
    },
  });

  function reset() {
    setMode("direct");
    setName("");
    setEmail("");
    setRole("team_member");
    setDepartmentId("none");
    setReportsToId("none");
    setInviteUrl(null);
    setInviteExpiresAt(null);
    setCopied(false);
  }

  async function copyInviteLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      pushToast({ title: "Invite link copied", tone: "success" });
    } catch {
      pushToast({ title: "Couldn't access the clipboard", body: "Copy the link manually.", tone: "error" });
    }
  }

  const isPending = addMemberMutation.isPending || inviteMutation.isPending;
  const canSubmit =
    email.trim().length > 0 &&
    (mode === "invite" || name.trim().length > 0) &&
    !(role === "team_lead" && departmentId === "none");

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        onOpenChange(nextOpen);
        if (!nextOpen) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Team Member</DialogTitle>
          <DialogDescription>
            Add a new member directly or generate an invite link.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {inviteUrl ? (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
              <Label htmlFor="invite-link">Invite Link</Label>
              <Input id="invite-link" readOnly value={inviteUrl} />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={copyInviteLink}>
                  {copied ? "Copied" : "Copy link"}
                </Button>
                {inviteExpiresAt && (
                  <span className="text-xs text-muted-foreground">
                    This link {formatInviteExpiry(inviteExpiresAt)}.
                  </span>
                )}
              </div>
            </div>
          ) : (
          <>
          {/* Mode toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === "direct" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("direct")}
            >
              Add directly
            </Button>
            <Button
              variant={mode === "invite" ? "default" : "outline"}
              size="sm"
              onClick={() => setMode("invite")}
            >
              Create invite link
            </Button>
          </div>

          {mode === "direct" && (
            <div className="space-y-1.5">
              <Label htmlFor="add-name">Name</Label>
              <Input
                id="add-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="person@company.com"
              type="email"
            />
            {mode === "invite" && (
              <p className="text-xs text-muted-foreground">
                The link is tied to this email — when they sign in with Google using
                it, they're admitted automatically. Anyone else who opens the link
                waits for your approval.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {isSystemAdmin && <SelectItem value="founder">Founder</SelectItem>}
                  <SelectItem value="team_lead">Team Lead</SelectItem>
                  <SelectItem value="team_member">Team Member</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {role !== "founder" && (
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Optional" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {role === "team_lead" ? "Select department" : "No department"}
                    </SelectItem>
                    {departmentOptions.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Reports to</Label>
            <Select value={reportsToId} onValueChange={setReportsToId}>
              <SelectTrigger>
                <SelectValue placeholder="No manager" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No manager (root)</SelectItem>
                {reportsToOptions.map((m) => (
                  <SelectItem key={m.userId} value={m.userId}>
                    {m.displayName ?? m.email ?? m.userId.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          </>
          )}
        </DialogBody>

        <DialogFooter>
          {inviteUrl ? (
            <Button onClick={() => { onOpenChange(false); reset(); }}>
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="ghost"
                onClick={() => { onOpenChange(false); reset(); }}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (mode === "direct") {
                    addMemberMutation.mutate();
                  } else {
                    inviteMutation.mutate();
                  }
                }}
                disabled={isPending || !canSubmit}
              >
                {isPending
                  ? (mode === "direct" ? "Adding..." : "Creating...")
                  : (mode === "direct" ? "Add Member" : "Create link")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
