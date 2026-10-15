import { describe, it, expect } from "vitest";
import { UPSELL_CATALOG, fillTokens, catalogCopy, catalogCta, parseEntitlementError, catalogIdForError } from "./upsellCatalog.js";

describe("upsell catalog", () => {
  it("never uses an em dash in any copy (house style)", () => {
    for (const [id, e] of Object.entries(UPSELL_CATALOG)) {
      for (const text of [e.head, e.assistant, e.cta, e.secondary]) {
        if (text) expect(text.includes("—"), id).toBe(false);
      }
    }
  });

  it("fills tokens and leaves unknown ones visible", () => {
    expect(fillTokens("Ask [head coach first name] about [Team]", { "head coach first name": "Pat", Team: "Wolves" })).toBe("Ask Pat about Wolves");
    expect(fillTokens("[n] of [limit]", { n: 3 })).toBe("3 of [limit]");
  });

  it("returns role variants and hides pricing from assistants", () => {
    expect(catalogCopy("H2", "assistant")).toBe("This practice is saved but outside the team's visible history.");
    expect(catalogCopy("T1", "assistant")).toBeNull();
    expect(catalogCta("H2", "head")).toEqual({ label: "See Pro", href: "/pricing" });
    expect(catalogCta("H2", "assistant")).toBeNull();
    expect(catalogCta("T2a", "head")).toBeNull();
  });

  it("parses the server's coded refusals and nothing else", () => {
    const err = { message: "ENTITLEMENT_LIMIT:teams.assistants", details: '{"limit" : 2, "current_count" : 2}' };
    expect(parseEntitlementError(err)).toEqual({ kind: "limit", featureKey: "teams.assistants", limit: 2, currentCount: 2 });
    expect(parseEntitlementError({ message: "ENTITLEMENT_LOCKED:goals.trends" })).toMatchObject({ kind: "locked", featureKey: "goals.trends" });
    expect(parseEntitlementError({ message: "new row violates row-level security policy" })).toBeNull();
    expect(parseEntitlementError(null)).toBeNull();
  });

  it("maps refusals to catalog IDs, with per-site overrides", () => {
    expect(catalogIdForError({ message: "ENTITLEMENT_LIMIT:library.personal_templates" })).toBe("L3");
    expect(catalogIdForError({ message: "ENTITLEMENT_LIMIT:teams.assistants" }, { "teams.assistants": "T2a" })).toBe("T2a");
    expect(catalogIdForError({ message: "something else" })).toBeNull();
  });
});
