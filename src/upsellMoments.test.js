import { describe, it, expect } from "vitest";
import { pickValueMoment, countRecent, nextGapStreakMarker, gapStreak } from "./upsellMoments.js";

const NOW = new Date("2026-10-14T18:00:00Z").getTime();
const ago = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
const ahead = (days) => new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString();

describe("pickValueMoment", () => {
  it("shows the highest-priority eligible moment as a new impression", () => {
    expect(pickValueMoment(["V2", "V1"], {}, NOW)).toEqual({ id: "V2", isNew: true });
  });

  it("keeps an active card on screen without counting a new impression", () => {
    const state = { moments: { V1: { active: true, shown_at: ago(0.1) } }, impressions: [ago(0.1)] };
    expect(pickValueMoment(["V2", "V1"], state, NOW)).toEqual({ id: "V1", isNew: false });
  });

  it("allows at most one new moment per day", () => {
    const state = { moments: { V1: { active: false, dismissals: 1, snoozed_until: ahead(30) } }, impressions: [ago(0.5)] };
    expect(pickValueMoment(["V2"], state, NOW)).toBeNull();
  });

  it("allows at most two new moments per rolling 7 days", () => {
    const state = { impressions: [ago(2), ago(5)] };
    expect(pickValueMoment(["V3"], state, NOW)).toBeNull();
    expect(pickValueMoment(["V3"], { impressions: [ago(2), ago(8)] }, NOW)).toEqual({ id: "V3", isNew: true });
  });

  it("snoozes a dismissed moment for 30 days, then re-arms it", () => {
    const snoozed = { moments: { V1: { active: false, dismissals: 1, snoozed_until: ahead(10) } } };
    expect(pickValueMoment(["V1"], snoozed, NOW)).toBeNull();
    const rearmed = { moments: { V1: { active: false, dismissals: 1, snoozed_until: ago(1) } } };
    expect(pickValueMoment(["V1"], rearmed, NOW)).toEqual({ id: "V1", isNew: true });
  });

  it("retires a moment after a second dismissal", () => {
    const state = { moments: { V1: { active: false, dismissals: 2, snoozed_until: ago(40) } } };
    expect(pickValueMoment(["V1"], state, NOW)).toBeNull();
  });
});

describe("trigger helpers", () => {
  it("counts recent counter entries inside the window", () => {
    const state = { counters: { npg_expand: [ago(1), ago(3), ago(20)] } };
    expect(countRecent(state, "npg_expand", 14 * 24 * 60 * 60 * 1000, NOW)).toBe(2);
  });

  it("builds a two-practice streak for a gap missing from the plan", () => {
    const first = nextGapStreakMarker(null, 5, "missing_from_next_plan", "Shooting");
    expect(gapStreak(first)).toEqual({ streak: 1, categoryName: "Shooting" });
    expect(nextGapStreakMarker(first, 5, "missing_from_next_plan", "Shooting")).toBeNull();
    const second = nextGapStreakMarker(first, 6, "missing_from_next_plan", "Shooting");
    expect(gapStreak(second)).toEqual({ streak: 2, categoryName: "Shooting" });
    expect(gapStreak(nextGapStreakMarker(second, 7, "on_track", ""))).toEqual({ streak: 0, categoryName: "" });
  });
});
