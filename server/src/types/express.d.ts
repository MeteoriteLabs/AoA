interface Actor {
  type: "none" | "board" | "agent" | "mcp";
  source: string;
  userId?: string;
  companyId?: string;
  companyIds?: string[];
  /** Operator-plane authority (instance settings). Unclamped. NOT a data-plane bypass. */
  operator?: boolean;
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
