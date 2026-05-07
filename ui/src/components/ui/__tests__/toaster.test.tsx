import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Toaster } from "../toaster";
import { toast } from "@/lib/toast";

describe("Toaster", () => {
  it("renders without crashing", () => {
    const { container } = render(<Toaster />);
    // sonner renders an <ol> under aria region eventually; we just verify the component mounts cleanly
    expect(container).toBeInTheDocument();
  });
});

describe("toast helpers", () => {
  // Verify the helper module exports the expected API surface
  it("exports semantic helpers", () => {
    expect(typeof toast.success).toBe("function");
    expect(typeof toast.error).toBe("function");
    expect(typeof toast.warning).toBe("function");
    expect(typeof toast.info).toBe("function");
    expect(typeof toast.message).toBe("function");
    expect(typeof toast.dismiss).toBe("function");
  });
});
