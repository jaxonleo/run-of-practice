import { describe, it, expect } from "vitest";
import { findOverlappingPractice } from "./constants.js";

const practices = [
  { id: "a", teamId: "t1", status: "scheduled", date: "2026-10-20", startTime: "17:00", scheduledDurationMinutes: 90 },
  { id: "b", teamId: "t1", status: "completed", date: "2026-10-21", startTime: "17:00", scheduledDurationMinutes: 60 },
  { id: "c", teamId: "t2", status: "scheduled", date: "2026-10-20", startTime: "17:00", scheduledDurationMinutes: 60 },
  { id: "d", teamId: "t1", status: "scheduled", date: "2026-10-22", startTime: "09:00", scheduledDurationMinutes: null },
];

describe("findOverlappingPractice", () => {
  it("finds an overlapping practice on the same team and date", () => {
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-20", startTime: "18:00", durationMinutes: 60 })?.id).toBe("a");
  });
  it("treats back-to-back practices as not overlapping", () => {
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-20", startTime: "18:30", durationMinutes: 60 })).toBeNull();
  });
  it("ignores other teams, other dates, non-scheduled practices, and the practice itself", () => {
    expect(findOverlappingPractice(practices, { teamId: "t2", date: "2026-10-20", startTime: "18:30", durationMinutes: 30 })).toBeNull();
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-21", startTime: "17:00", durationMinutes: 60 })).toBeNull();
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-20", startTime: "17:00", durationMinutes: 60, excludeId: "a" })).toBeNull();
  });
  it("counts a missing duration as 60 minutes", () => {
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-22", startTime: "09:45", durationMinutes: "" })?.id).toBe("d");
    expect(findOverlappingPractice(practices, { teamId: "t1", date: "2026-10-22", startTime: "10:00", durationMinutes: 30 })).toBeNull();
  });
});
