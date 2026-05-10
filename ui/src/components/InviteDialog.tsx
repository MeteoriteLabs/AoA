import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Project, UserRole } from "@armyofagents/shared";
import { accessApi } from "../api/access";
import { queryKeys } from "../lib/queryKeys";
import { useToast } from "../context/ToastContext";
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

interface InviteDialogProps {
  companyId: string;
  departments: Project[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InviteDialog({
  companyId,
  departments,
  open,
  onOpenChange,
}: InviteDialogProps) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("team_member");
  const [departmentId, setDepartmentId] = useState<string>("none");
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);

  const departmentOptions = useMemo(
    () => departments.filter((department) => department.type === "department"),
    [departments],
  );

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
          },
        },
      }),
    onSuccess: async (result) => {
      setInviteUrl(result.inviteUrl);
      await queryClient.invalidateQueries({ queryKey: queryKeys.team.summary(companyId) });
      pushToast({
        title: "Invite created",
        body: email.trim(),
        tone: "success",
      });
    },
  });

  function reset() {
    setEmail("");
    setRole("team_member");
    setDepartmentId("none");
    setInviteUrl(null);
  }

  async function copyInviteLink() {
    if (!inviteUrl) return;
    await navigator.clipboard.writeText(inviteUrl);
    pushToast({ title: "Invite link copied", tone: "success" });
  }

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
          <DialogTitle>Invite Team Member</DialogTitle>
          <DialogDescription>
            Create a human join invite with the right starting role and department scope.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="person@company.com"
              type="email"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="team_lead">Team lead</SelectItem>
                  <SelectItem value="team_member">Team member</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Department Scope</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Optional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    {role === "team_lead" ? "Select department" : "No department"}
                  </SelectItem>
                  {departmentOptions.map((department) => (
                    <SelectItem key={department.id} value={department.id}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {inviteUrl && (
            <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
              <Label htmlFor="invite-link">Invite Link</Label>
              <Input id="invite-link" readOnly value={inviteUrl} />
              <Button variant="outline" size="sm" onClick={copyInviteLink}>
                Copy link
              </Button>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => {
              onOpenChange(false);
              reset();
            }}
          >
            Cancel
          </Button>
          <Button
            onClick={() => inviteMutation.mutate()}
            disabled={
              inviteMutation.isPending ||
              !email.trim() ||
              (role === "team_lead" && departmentId === "none")
            }
          >
            {inviteMutation.isPending ? "Sending..." : "Send invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
