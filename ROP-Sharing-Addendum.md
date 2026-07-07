# ROP Addendum — Library Sharing Model (read before Stage 3: Library)

**Status: decided 2026-07-06. Supersedes nothing; extends the main Frontend Rewire Handoff. Implement the schema piece as a proper migration (dry-run → push discipline), not ad-hoc SQL.**

## The decision

Coach-created drills (`activity_library`) and templates (`templates`) get a sharing setting:

- **Private (default):** visible only to the owning coach. Every new drill/template starts here.
- **Shared with a specific org:** the coach explicitly picks ONE org they belong to. Org members can then view and copy it. Multi-org coaches pick per-item; sharing with multiple orgs at once is deferred (single column now; a join table is a mechanical migration later if demand appears).
- **Public:** DEFERRED entirely to chunk 6 (catalogs). Do not build any public visibility, browsing, or link-sharing surface now. The strategy question (free public commons vs. paid curated catalogs) is deliberately unresolved.

This does NOT reverse the admin-curated org library decision. Two distinct shelves exist in an org context:

1. **Org Library** — org-*owned* rows (`organization_id` set), created/edited by org admins only. Unchanged.
2. **From Our Coaches** — coach-*owned* rows shared into the org (`shared_with_organization_id` set). Owned and edited by the sharing coach; org members see edits live; view + copy only, never edit.

## Schema spec

New column on BOTH `activity_library` and `templates`:

```sql
shared_with_organization_id uuid references public.organizations(id)
```

Constraints/rules:
- Only coach-owned rows may be shared: `shared_with_organization_id is null or owner_user_id is not null` (an org-owned row sharing itself with an org is meaningless and must be impossible).
- Do NOT reuse `organization_id` for this — that column means org-OWNED (admin-curated). Conflating them destroys the two-shelf distinction.
- The share action (UPDATE setting the column) must verify the coach is a member of the target org: add a `WITH CHECK` on the update policies requiring `shared_with_organization_id is null or public.is_org_member(shared_with_organization_id)`.

RLS changes (follow the existing patterns; all checks are on the row's own columns + membership functions — no self-referential lookups, see "recurring bug" note below):
- `activity_library` / `templates` SELECT: add `or (shared_with_organization_id is not null and public.is_org_member(shared_with_organization_id))`.
- `can_access_activity` (used by `activity_library_equipment` and `drill_tags` policies) and the template equivalents: add the same shared branch so the join rows are visible to org viewers.
- `assets` SELECT: narrow extension so viewers of a shared drill/template can read the linked assets' names — an `exists` over the equipment join tables to a row shared with an org the viewer belongs to (`assets_..._asset_id` indexes already exist for this).
- `can_link_drill_to_practice`, `can_link_drill_to_template`, `can_link_drill_to_template_station`: add the shared branch, so copying a shared drill can record `library_activity_id` lineage without being rejected.
- `skill_tags`: deliberately UNCHANGED. A sharer's private (`coach`-scoped) tags never become visible to viewers — the drill_tags join row may be visible while the tag itself is not. Frontend must render missing/null tags gracefully (just omit them); viewers see only global + that org's tags on shared content.

## Copy semantics (critical — recurring bug class)

The schema build hit the same bug five times: a shared thing referencing a private thing its viewers can't see. Two of those five are in this feature. The rules:

1. **Viewing a shared drill/template:** equipment names are readable via the assets RLS extension above. Private tags simply don't show.
2. **Copying a shared drill into a practice/template (or "save to my library"):** equipment does NOT copy as references to the sharer's asset rows. Treat the foreign drill's concrete assets as name-based requirements and resolve into the RECIPIENT's own pool: match by name (case-insensitive) against their existing assets for that sport; if no match, inline-create in their personal library and link (this is the existing "type a new one → added to library + linked" behavior, applied automatically). The recipient's copy must never reference an asset they don't own/can't manage.
3. **Un-sharing / leaving the org:** visibility is derived from `is_org_member` + the column, so shared items vanish from the shelf automatically when either changes. Existing copies are untouched (copy-not-reference). Frontend: the staleness check (`library_activity_synced_at` vs source `updated_at`) must handle "source no longer visible" as a quiet "source unavailable" state, not an error.

## UI spec (Stage 3 Library screen)

- Shelves/tabs: **My Library** · **Org Library** (per org, admin-curated) · **From Our Coaches** (per org, coach-shared). Coaches in no org see only My Library.
- Share control on coach-owned items only: Private (default) / Share with [org picker — only orgs the coach belongs to]. Org-owned items get no share control.
- Shared items viewed by non-owners: read-only, with prominent **Copy to my library** / **Add to practice** actions and the sharer's name shown (attribution comes free from `owner_user_id` → but note: profiles are not cross-readable by design; display name should come from the coach's `team_staff` record where available, or add a minimal public-display-name mechanism — flag this to Jax if it becomes blocking, don't invent cross-profile reads).
- Org admins: no special powers over coach-shared items in v1. (Future, not now: "promote to Org Library" = admin makes an org-owned copy. Falls out of copy-not-reference for free.)

## Deferred (do not build)

- Public visibility in any form (chunk 6, alongside catalogs)
- Multi-org simultaneous sharing (join-table migration later if wanted)
- Admin promote-to-org-library action
- Any moderation/reporting surface (only needed once public exists)
