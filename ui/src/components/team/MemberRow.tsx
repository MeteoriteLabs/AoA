import { X, Bot } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { TeamRole } from "@armyofagents/shared";

export type DraftMember =
  | { kind: "existing"; agentId: string; name: string; role: TeamRole }
  | {
      kind: "new";
      tempId: string;
      name: string;
      adapterType: string;
      skillKeys: string[];
      role: TeamRole;
    };

interface Props {
  member: DraftMember;
  onChange: (next: DraftMember) => void;
  onRemove: () => void;
}

export function MemberRow({ member, onChange, onRemove }: Props) {
  return (
    <div
      className={cn(
        "mb-2 rounded-md border bg-card p-2.5",
        member.kind === "new" && "border-2 border-indigo-500",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent">
          <Bot className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          {member.kind === "existing" ? (
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold">{member.name}</span>
              <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 text-[9px]">
                EXISTING
              </Badge>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={member.name}
                onChange={(e) => onChange({ ...member, name: e.target.value })}
                placeholder="Agent name"
                className="h-6 text-xs"
              />
              <Badge className="bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-400 text-[9px]">
                NEW
              </Badge>
            </div>
          )}
        </div>
        <Select
          value={member.role}
          onValueChange={(r) => onChange({ ...member, role: r as TeamRole })}
        >
          <SelectTrigger className="h-7 w-[100px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="lead">⭐ Lead</SelectItem>
            <SelectItem value="member">Member</SelectItem>
          </SelectContent>
        </Select>
        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remove member"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {member.kind === "new" && (
        <div className="mt-2 ml-9 grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground">Adapter</label>
            <Select
              value={member.adapterType}
              onValueChange={(v) => onChange({ ...member, adapterType: v })}
            >
              <SelectTrigger className="h-6 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="claude_local">claude_local</SelectItem>
                <SelectItem value="codex_local">codex_local</SelectItem>
                <SelectItem value="opencode_local">opencode_local</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground">
              Skills (comma-sep)
            </label>
            <Input
              value={member.skillKeys.join(", ")}
              onChange={(e) =>
                onChange({
                  ...member,
                  skillKeys: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="react, css, ..."
              className="h-6 text-xs"
            />
          </div>
        </div>
      )}
    </div>
  );
}
