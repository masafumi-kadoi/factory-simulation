-- 016: execution_configs に simulation_time カラムを追加
-- シミュレーション実行時間(秒)を保存し、タイムライン再生に使用する

ALTER TABLE execution_configs
    ADD COLUMN IF NOT EXISTS simulation_time FLOAT DEFAULT 86400;
