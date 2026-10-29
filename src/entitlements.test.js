import { describe, it, expect } from "vitest";
import { FEATURE_FLAGS, can, isTestEnvironmentUrl } from "./entitlements.js";

describe("entitlement launch guard", () => {
  // Packaging handoff (2026-10-14) launch guard. Billing must not turn on
  // while entitlement_settings.founding_cohort_cutoff is unset, or every
  // signup before launch would keep Founding Coach access forever. The
  // server enforces this with a CHECK on entitlement_settings
  // (pgTAP 09_packaging_phase_a); this pin makes flipping the client flag a
  // deliberate edit to this test, made alongside setting the cutoff.
  it("keeps BILLING_ENABLED off until the founding cutoff is set", () => {
    expect(FEATURE_FLAGS.BILLING_ENABLED).toBe(false);
  });
});

describe("can()", () => {
  it("treats full and preview as accessible, locked and missing as not", () => {
    const map = {
      "goals.trends": { state: "preview", limit_value: null, source: "plan" },
      "benchmarks.access": { state: "locked", limit_value: null, source: "plan" },
      "goals.access": { state: "full", limit_value: null, source: "cohort" },
    };
    expect(can("goals.access", map).allowed).toBe(true);
    expect(can("goals.trends", map).allowed).toBe(true);
    expect(can("benchmarks.access", map).allowed).toBe(false);
    expect(can("library.drill_insights", map)).toMatchObject({ allowed: false, source: "unresolved" });
  });
});

describe("isTestEnvironmentUrl", () => {
  it("is true only for the staging Supabase project", () => {
    expect(isTestEnvironmentUrl("https://vgryzeokdxgthpjezqns.supabase.co")).toBe(true);
    expect(isTestEnvironmentUrl("https://bepoojcbizxhqadrytjq.supabase.co")).toBe(false);
    expect(isTestEnvironmentUrl("https://vgryzeokdxgthpjezqns.evil.com.bepoojcbizxhqadrytjq.supabase.co")).toBe(false);
    expect(isTestEnvironmentUrl(undefined)).toBe(false);
  });
});
