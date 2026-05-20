-- 019: Fix two data quality issues left after migration 018
--
-- Fix 1: Restore parent_id for non-machine stations that were accidentally
--         at the top level (parent_id=NULL) despite belonging to a machine.
--         Condition: station_id starts with machine.station_id + '.'
--         Example: machine1.processing (equipment_id=machine1) → parent_id=machine1
--
-- Fix 2: Rename source/drain nodes that still have old .000 suffix naming.
--         station_id → equipment_id (e.g. source.000 → source, drain.000 → drain)
--         Also updates factory_connections references.

BEGIN;

-- -------------------------------------------------------
-- Fix 1: Reparent orphaned child stations
-- -------------------------------------------------------
UPDATE factory_stations child
SET parent_id = machine.station_id
FROM factory_stations machine
WHERE machine.station_type = 'machine'
  AND machine.parent_id IS NULL
  AND child.factory_id = machine.factory_id
  AND child.parent_id IS NULL
  AND child.station_type NOT IN ('machine', 'source', 'drain')
  AND child.station_id LIKE machine.station_id || '.%';

-- -------------------------------------------------------
-- Fix 2a: Update factory_connections referencing old source/drain station_ids
-- -------------------------------------------------------
UPDATE factory_connections fc
SET from_station = node.equipment_id
FROM factory_stations node
WHERE fc.factory_id = node.factory_id
  AND fc.from_station = node.station_id
  AND node.station_type IN ('source', 'drain')
  AND node.station_id != node.equipment_id
  AND node.parent_id IS NULL;

UPDATE factory_connections fc
SET to_station = node.equipment_id
FROM factory_stations node
WHERE fc.factory_id = node.factory_id
  AND fc.to_station = node.station_id
  AND node.station_type IN ('source', 'drain')
  AND node.station_id != node.equipment_id
  AND node.parent_id IS NULL;

-- -------------------------------------------------------
-- Fix 2b: Rename source/drain station_ids to match equipment_id
--         Skip if the clean name already exists in the same factory
-- -------------------------------------------------------
UPDATE factory_stations
SET station_id = equipment_id
WHERE station_type IN ('source', 'drain')
  AND station_id != equipment_id
  AND parent_id IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM factory_stations existing
      WHERE existing.factory_id = factory_stations.factory_id
        AND existing.station_id = factory_stations.equipment_id
  );

COMMIT;
