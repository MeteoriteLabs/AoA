import { describe, expect, it } from "vitest";
import { secretRoutes } from "../routes/secrets.js";

describe("secret routes", () => {
  it("mounts provider config, binding, access-event, and remote import routes", () => {
    const router = secretRoutes({} as any) as any;
    const routePaths = router.stack
      .map((layer: any) => layer.route?.path)
      .filter(Boolean);

    expect(routePaths).toContain("/companies/:companyId/secret-provider-configs");
    expect(routePaths).toContain("/secret-provider-configs/:id");
    expect(routePaths).toContain("/secret-provider-configs/:id/check");
    expect(routePaths).toContain("/secrets/:id/bindings");
    expect(routePaths).toContain("/secret-bindings/:id");
    expect(routePaths).toContain("/secrets/:id/access-events");
    expect(routePaths).toContain("/companies/:companyId/secrets/remote-import/preview");
    expect(routePaths).toContain("/companies/:companyId/secrets/remote-import");
  });
});
