-- 015: factory-visualizer 統合スキーマ
-- factory_stations 拡張、scenarios 系テーブル廃止、execution_configs 更新

-- ============================================================
-- 1. factory_stations: parent_id / position_z 追加、型変換、seq_number削除
-- ============================================================

-- 内部ステーション用親参照（Machine 本体は NULL、子ステーションは親の station_id を持つ）
ALTER TABLE factory_stations ADD COLUMN parent_id TEXT;

-- 3D 座標 Z 軸
ALTER TABLE factory_stations ADD COLUMN position_z DOUBLE PRECISION DEFAULT 0;

-- 座標精度を REAL → DOUBLE PRECISION に統一（Three.js 側の計算精度に合わせる）
ALTER TABLE factory_stations ALTER COLUMN position_x TYPE DOUBLE PRECISION;
ALTER TABLE factory_stations ALTER COLUMN position_y TYPE DOUBLE PRECISION;

-- seq_number: ビジネスロジックで未使用、station_id から派生可能なため削除
ALTER TABLE factory_stations DROP COLUMN IF EXISTS seq_number;

-- station_type: 物理設備の正式名称 'machine' に統一（旧称 'moduler' から移行）
UPDATE factory_stations SET station_type = 'machine' WHERE station_type = 'moduler';

-- 親子参照の複合 FK: (factory_id, parent_id) → (factory_id, station_id)
-- parent_id が NULL の行（Machine 本体）は FK チェックをスキップ
-- DEFERRABLE INITIALLY DEFERRED: バッチ INSERT 時に親子の順不同挿入を許可
ALTER TABLE factory_stations ADD CONSTRAINT fk_factory_stations_parent
    FOREIGN KEY (factory_id, parent_id)
    REFERENCES factory_stations(factory_id, station_id)
    ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED;

-- ============================================================
-- 2. factory_connections: port_index デフォルト値 0 → -1（未設定を明示）
-- ============================================================

ALTER TABLE factory_connections ALTER COLUMN from_port_index SET DEFAULT -1;
ALTER TABLE factory_connections ALTER COLUMN to_port_index SET DEFAULT -1;

-- ============================================================
-- 3. execution_configs: factory_id 追加、scenario_id NOT NULL 解除
-- ============================================================

ALTER TABLE execution_configs ALTER COLUMN scenario_id DROP NOT NULL;
ALTER TABLE execution_configs ADD COLUMN IF NOT EXISTS factory_id UUID REFERENCES factories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_execution_configs_factory ON execution_configs(factory_id);

-- ============================================================
-- 4. scenarios 系テーブル廃止（データは破棄、factory_stations/connections に統合済み）
-- CASCADE により依存する FK・インデックスも自動削除
-- ============================================================

DROP TABLE IF EXISTS scenario_connections CASCADE;
DROP TABLE IF EXISTS scenario_stations CASCADE;
DROP TABLE IF EXISTS scenarios CASCADE;
