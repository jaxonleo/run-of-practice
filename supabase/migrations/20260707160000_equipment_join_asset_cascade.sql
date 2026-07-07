-- Fourth instance of the actor/resource-deletion FK pattern (see
-- rop_actor_deletion_fk_gotcha memory), found empirically while cleaning up
-- a stage-4 test user: deleting a user cascades to their assets
-- (assets.owner_user_id references profiles(id) on delete cascade), but
-- four equipment join tables referenced assets(id) with no ON DELETE
-- behavior (defaults to RESTRICT), blocking the whole cascade with
-- "update or delete on table assets violates foreign key constraint
-- station_equipment_asset_id_fkey" (23503).
--
-- activity_library_equipment and drill_tags already had ON DELETE CASCADE
-- set correctly from the original schema build -- these four siblings just
-- never got the same treatment, an inconsistency, not a deliberate choice.
--
-- CASCADE (not SET NULL) is correct here, not just for the actor-deletion
-- case: template_activity_equipment/template_station_equipment enforce a
-- concrete-XOR-abstract CHECK (asset_id set XOR requirement_name set) --
-- nulling asset_id without also setting requirement_name would violate
-- that constraint. If the underlying asset is gone, the equipment slot
-- itself is meaningless and should disappear, not dangle.
alter table public.template_activity_equipment drop constraint template_activity_equipment_asset_id_fkey;
alter table public.template_activity_equipment
  add constraint template_activity_equipment_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete cascade;

alter table public.template_station_equipment drop constraint template_station_equipment_asset_id_fkey;
alter table public.template_station_equipment
  add constraint template_station_equipment_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete cascade;

alter table public.practice_activity_equipment drop constraint practice_activity_equipment_asset_id_fkey;
alter table public.practice_activity_equipment
  add constraint practice_activity_equipment_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete cascade;

alter table public.station_equipment drop constraint station_equipment_asset_id_fkey;
alter table public.station_equipment
  add constraint station_equipment_asset_id_fkey
  foreign key (asset_id) references public.assets(id) on delete cascade;
