import { describe, it, expect } from "vitest";
import { defaultActiveTeamId } from "./teamPlan.js";

describe("defaultActiveTeamId", () => {
  const teams = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("picks the team with the soonest upcoming scheduled practice", () => {
    const practices = [
      { teamId: "a", status: "scheduled", date: "2026-10-20", startTime: "17:00" },
      { teamId: "c", status: "scheduled", date: "2026-10-16", startTime: "09:00" },
      { teamId: "b", status: "completed", date: "2026-10-15", startTime: "09:00" },
    ];
    expect(defaultActiveTeamId(teams, practices, "2026-10-15")).toBe("c");
  });
  it("ignores past practices and falls back to the first team", () => {
    const practices = [{ teamId: "b", status: "scheduled", date: "2026-10-01", startTime: "09:00" }];
    expect(defaultActiveTeamId(teams, practices, "2026-10-15")).toBe("a");
    expect(defaultActiveTeamId([], [], "2026-10-15")).toBeNull();
  });
});
