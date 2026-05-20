-- 018: Consolidate equipment group hubs into single machine entities
--
-- Before:
--   station_id="fuga001", equipment_id="fuga", station_type="machine", parent_id=NULL
--   station_id="fuga002", equipment_id="fuga", station_type="machine", parent_id=NULL
--   station_id="fuga001.entry", equipment_id="fuga001", parent_id="fuga001"
--   station_id="fuga002.entry", equipment_id="fuga002", parent_id="fuga002"
--
-- After:
--   station_id="fuga",         equipment_id="fuga", station_type="machine", parent_id=NULL  (new)
--   station_id="fuga001.entry", equipment_id="fuga", parent_id="fuga"  (reparented)
--   station_id="fuga002.entry", equipment_id="fuga", parent_id="fuga"  (reparented)
--   (fuga001 and fuga002 hub rows deleted)
--
-- Condition: only affects machines where station_id != equipment_id
-- (machines already named as their equipment_id are untouched)

BEGIN;

-- -------------------------------------------------------
-- Step 1: Create new machine entities (equipment_id becomes station_id)
--         Position = centroid of all hubs in the group
--         Config copied from the hub with lowest station_id (typically the .000 master)
-- -------------------------------------------------------
INSERT INTO factory_stations (
    factory_id, station_id, equipment_id, parent_id,
    name, station_type,
    position_x, position_y, position_z,
    config
)
SELECT
    factory_id,
    equipment_id AS station_id,
    equipment_id,
    NULL,
    equipment_id AS name,
    'machine',
    AVG(position_x),
    AVG(position_y),
    0,
    -- Config from the hub with lowest station_id (prefer .000 suffix)
    (
        SELECT config
        FROM factory_stations hub_cfg
        WHERE hub_cfg.factory_id = g.factory_id
          AND hub_cfg.equipment_id = g.equipment_id
          AND hub_cfg.station_type = 'machine'
          AND hub_cfg.parent_id IS NULL
          AND hub_cfg.station_id != hub_cfg.equipment_id
        ORDER BY
            CASE WHEN hub_cfg.station_id LIKE '%000' THEN 0 ELSE 1 END,
            hub_cfg.station_id
        LIMIT 1
    )
FROM factory_stations g
WHERE g.station_type = 'machine'
  AND g.parent_id IS NULL
  AND g.station_id != g.equipment_id
GROUP BY g.factory_id, g.equipment_id
ON CONFLICT (factory_id, station_id) DO NOTHING;

-- -------------------------------------------------------
-- Step 2: Reparent child stations from old hub machines to the new machine entity
--         Also update their equipment_id to match the new parent
-- -------------------------------------------------------
UPDATE factory_stations child
SET
    parent_id    = hub.equipment_id,
    equipment_id = hub.equipment_id
FROM factory_stations hub
WHERE child.parent_id = hub.station_id
  AND hub.station_type = 'machine'
  AND hub.parent_id IS NULL
  AND hub.station_id != hub.equipment_id;

-- -------------------------------------------------------
-- Step 3: Update factory_connections — replace old hub IDs with new equipment entity IDs
-- -------------------------------------------------------
UPDATE factory_connections fc
SET from_station = hub.equipment_id
FROM factory_stations hub
WHERE fc.from_station = hub.station_id
  AND hub.station_type = 'machine'
  AND hub.parent_id IS NULL
  AND hub.station_id != hub.equipment_id;

UPDATE factory_connections fc
SET to_station = hub.equipment_id
FROM factory_stations hub
WHERE fc.to_station = hub.station_id
  AND hub.station_type = 'machine'
  AND hub.parent_id IS NULL
  AND hub.station_id != hub.equipment_id;

-- -------------------------------------------------------
-- Step 4: Delete old hub machine rows
--         (children are already reparented so no cascade-delete occurs)
-- -------------------------------------------------------
DELETE FROM factory_stations
WHERE station_type = 'machine'
  AND parent_id IS NULL
  AND station_id != equipment_id;

COMMIT;
