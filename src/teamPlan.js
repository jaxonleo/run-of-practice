// Packaging Phase E helpers kept out of component files (fast refresh
// wants component modules to export only components).
import { localDateStr } from "./constants.js";

export function defaultActiveTeamId(teams, practices, todayStr = localDateStr()) {
  // Practices carry a team-local date/startTime; the soonest upcoming
  // scheduled one wins. Teams with nothing scheduled sort last, oldest first
  // (the caller passes teams in creation order).
  const nextKey = t => {
    const keys = (practices || [])
      .filter(p => p.teamId === t.id && p.status === "scheduled" && p.date && p.date >= todayStr)
      .map(p => p.date + " " + (p.startTime || ""));
    return keys.length ? keys.sort()[0] : null;
  };
  // Plain code-point comparison (localeCompare would rank punctuation and
  // digits differently); teams with nothing upcoming keep their order last.
  const sorted = [...teams].sort((a, b) => {
    const ka = nextKey(a), kb = nextKey(b);
    if (ka === kb) return 0;
    if (ka === null) return 1;
    if (kb === null) return -1;
    return ka < kb ? -1 : 1;
  });
  return sorted.length ? sorted[0].id : null;
}
