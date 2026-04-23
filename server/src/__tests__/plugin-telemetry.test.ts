import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PaperclipPluginManifestV1 } from "@armyofagents/shared";

const debugSpy = vi.hoisted(() => vi.fn());

vi.mock("../middleware/logger.js", () => ({
  logger: {
    debug: debugSpy,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

import { createHostClientHandlers } from "@armyofagents/plugin-sdk";
import { createTestHarness } from "@armyofagents/plugin-sdk";
import { buildHostServices } from "../services/plugin-host-services.js";

function createEventBusStub() {
  return {
    forPlugin() {
      return { emit: vi.fn(), subscribe: vi.fn() };
    },
  } as never;
}

function buildTelemetryTestManifest(
  overrides: Partial<PaperclipPluginManifestV1> = {},
): PaperclipPluginManifestV1 {
  return {
    id: "telemetry-test",
    apiVersion: 1,
    version: "1.0.0",
    displayName: "Telemetry Test Plugin",
    description: "Fixture used by plugin-telemetry.test.ts",
    author: "AoA",
    categories: ["automation"],
    capabilities: ["telemetry.track"],
    ...overrides,
  };
}

describe("plugin telemetry bridge (F.5, infrastructure-only)", () => {
  beforeEach(() => {
    debugSpy.mockReset();
  });

  // ---------------------------------------------------------------------------
  // plugin-host-services telemetry implementation (log-and-discard per F.D4)
  // ---------------------------------------------------------------------------

  it("accepts a valid event name and logs at debug with pluginId+pluginKey+eventName+dimensions", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );

    await services.telemetry.track({
      eventName: "sync_completed",
      dimensions: { attempts: 2, success: true },
    });

    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith(
      {
        pluginId: "plugin-rec-id",
        pluginKey: "linear",
        eventName: "sync_completed",
        dimensions: { attempts: 2, success: true },
      },
      "Plugin telemetry event (log-and-discard; phase-I routes)",
    );
  });

  it("accepts event names with underscores, dashes, and digits", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );

    await expect(services.telemetry.track({ eventName: "step_1_done" })).resolves.toBeUndefined();
    await expect(services.telemetry.track({ eventName: "retry-limit-hit" })).resolves.toBeUndefined();
    await expect(services.telemetry.track({ eventName: "0_cold_start" })).resolves.toBeUndefined();
    expect(debugSpy).toHaveBeenCalledTimes(3);
  });

  it("rejects event names containing dots, spaces, uppercase, or leading non-alphanumeric", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );

    const expected =
      'Plugin telemetry event names must be lowercase slugs using letters, numbers, "_" or "-".';

    await expect(services.telemetry.track({ eventName: "sync.completed" })).rejects.toThrow(expected);
    await expect(services.telemetry.track({ eventName: "Sync_Completed" })).rejects.toThrow(expected);
    await expect(services.telemetry.track({ eventName: "sync completed" })).rejects.toThrow(expected);
    await expect(services.telemetry.track({ eventName: "_leading_underscore" })).rejects.toThrow(expected);
    await expect(services.telemetry.track({ eventName: "-leading-dash" })).rejects.toThrow(expected);
    await expect(services.telemetry.track({ eventName: "" })).rejects.toThrow(expected);

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("returns void without routing when called (log-and-discard, no destination wired)", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );

    const result = await services.telemetry.track({
      eventName: "noop_event",
      dimensions: { a: "x" },
    });

    expect(result).toBeUndefined();
    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // createHostClientHandlers — RPC dispatch gating
  // ---------------------------------------------------------------------------

  it("exposes 'telemetry.track' in the host-client-handlers map", () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );
    const handlers = createHostClientHandlers({
      pluginId: "linear",
      capabilities: ["telemetry.track"],
      services,
    });

    expect(typeof handlers["telemetry.track"]).toBe("function");
  });

  it("gates RPC dispatch: plugins without 'telemetry.track' capability are denied", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );
    const handlers = createHostClientHandlers({
      pluginId: "linear",
      capabilities: [],
      services,
    });

    await expect(
      handlers["telemetry.track"]({ eventName: "sync_completed" }),
    ).rejects.toThrow(/telemetry\.track/);

    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("dispatches through to plugin-host-services when capability is granted", async () => {
    const services = buildHostServices(
      {} as never,
      "plugin-rec-id",
      "linear",
      createEventBusStub(),
    );
    const handlers = createHostClientHandlers({
      pluginId: "linear",
      capabilities: ["telemetry.track"],
      services,
    });

    await handlers["telemetry.track"]({
      eventName: "sync_completed",
      dimensions: { source: "manual" },
    });

    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "sync_completed" }),
      expect.any(String),
    );
  });

  // ---------------------------------------------------------------------------
  // createTestHarness — plugin author-facing test fixture
  // ---------------------------------------------------------------------------

  it("createTestHarness records telemetry.track calls on harness.telemetry", async () => {
    const harness = createTestHarness({ manifest: buildTelemetryTestManifest() });

    await harness.ctx.telemetry.track("hello_world", { k: "v" });
    await harness.ctx.telemetry.track("second_event");

    expect(harness.telemetry).toEqual([
      { eventName: "hello_world", dimensions: { k: "v" } },
      { eventName: "second_event", dimensions: undefined },
    ]);
  });

  it("createTestHarness throws when the plugin lacks telemetry.track capability", async () => {
    const harness = createTestHarness({
      manifest: buildTelemetryTestManifest({ capabilities: [] }),
    });

    await expect(harness.ctx.telemetry.track("denied_event")).rejects.toThrow();
    expect(harness.telemetry).toHaveLength(0);
  });

  it("ctx.telemetry.track accepts dimensions of mixed scalar types (string/number/boolean)", async () => {
    const harness = createTestHarness({ manifest: buildTelemetryTestManifest() });

    await harness.ctx.telemetry.track("mixed_dims", {
      source: "cli",
      attempts: 3,
      success: true,
    });

    expect(harness.telemetry[0]?.dimensions).toEqual({
      source: "cli",
      attempts: 3,
      success: true,
    });
  });
});
