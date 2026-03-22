interface Actor {
  type: "none" | "board" | "agent" | "mcp";
  source: string;
  userId?: string;
  companyId?: string;
  companyIds?: string[];
  agentId?: string;
  keyId?: string;
  runId?: string;
  isInstanceAdmin?: boolean;
}

declare namespace Express {
  interface Request {
    actor: Actor;
  }
}
