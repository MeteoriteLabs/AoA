import { describe, expect, it } from "vitest";
import { sanitizeRemoteExecutionEnv } from "./remote-execution-env.js";

describe("sanitizeRemoteExecutionEnv", () => {
  it("strips host identity values when they match the host env", () => {
    expect(
      sanitizeRemoteExecutionEnv(
        {
          HOME: "/Users/tk",
          PATH: "/usr/bin",
          AOA_RUN_ID: "run_1",
        },
        {
          HOME: "/Users/tk",
          PATH: "/usr/bin",
        },
      ),
    ).toEqual({ AOA_RUN_ID: "run_1" });
  });

  it("preserves explicit different identity values", () => {
    expect(
      sanitizeRemoteExecutionEnv(
        {
          HOME: "/sandbox/home",
          Path: "C:\\sandbox\\bin",
          TEMP: "/tmp/adapter",
        },
        {
          HOME: "/Users/tk",
          Path: "C:\\Windows",
          TEMP: "/tmp/adapter",
        },
      ),
    ).toEqual({
      HOME: "/sandbox/home",
      Path: "C:\\sandbox\\bin",
    });
  });
});
