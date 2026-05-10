package player

import (
	"context"
	"fmt"
	"log"
	"math"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"simdb-test-driver/source"

	"github.com/jackc/pgx/v5/pgxpool"
)

type State string

const (
	StateIdle      State = "idle"
	StateLoaded    State = "loaded"
	StateRunning   State = "running"
	StatePaused    State = "paused"
	StateCompleted State = "completed"
	StateError     State = "error"
)

type Status struct {
	State              State   `json:"state"`
	SourceName         string  `json:"source"`
	CurrentEventIndex  int     `json:"current_event_index"`
	TotalEvents        int     `json:"total_events"`
	ElapsedScenarioSec float64 `json:"elapsed_scenario_sec"`
	SpeedMultiplier    float64 `json:"speed_multiplier"`
	DataSourceID       string  `json:"data_source_id,omitempty"`
}

type Player struct {
	pool   *pgxpool.Pool
	mu     sync.Mutex
	state  State
	src    source.DataSource
	events []source.TimedEvent
	cursor int

	// speed は 1000 倍整数で保持（0.001 精度、atomic アクセス）
	speedMillis atomic.Int64

	cancelRun context.CancelFunc
	wg        sync.WaitGroup

	// central モード: 起動時に一度だけ設定され、再生中は変更されない
	dataSourceID        string
	normalizeTimestamps bool
}

func New(pool *pgxpool.Pool) *Player {
	p := &Player{pool: pool, state: StateIdle}
	p.setSpeed(1.0)
	return p
}

// SetDataSourceID は central モード用の data_source_id を設定する。
func (p *Player) SetDataSourceID(id string) {
	p.mu.Lock()
	p.dataSourceID = id
	p.mu.Unlock()
}

// SetNormalizeTimestamps は true のとき INSERT 時の event_time を wall clock に置き換える。
func (p *Player) SetNormalizeTimestamps(v bool) {
	p.mu.Lock()
	p.normalizeTimestamps = v
	p.mu.Unlock()
}

func (p *Player) setSpeed(v float64) {
	p.speedMillis.Store(int64(v * 1000))
}

func (p *Player) getSpeed() float64 {
	return float64(p.speedMillis.Load()) / 1000.0
}

func (p *Player) Status() Status {
	p.mu.Lock()
	defer p.mu.Unlock()
	name := ""
	if p.src != nil {
		name = p.src.Name()
	}
	elapsed := 0.0
	if len(p.events) > 0 && p.cursor > 0 {
		elapsed = p.events[p.cursor-1].EventTime.Sub(p.events[0].EventTime).Seconds()
	}
	return Status{
		State:              p.state,
		SourceName:         name,
		CurrentEventIndex:  p.cursor,
		TotalEvents:        len(p.events),
		ElapsedScenarioSec: elapsed,
		SpeedMultiplier:    p.getSpeed(),
		DataSourceID:       p.dataSourceID,
	}
}

// Load はデータソースを読み込んでマスタを INSERT し、loaded 状態に遷移する。
func (p *Player) Load(src source.DataSource) error {
	p.mu.Lock()
	defer p.mu.Unlock()

	// 再生中なら停止
	if p.state == StateRunning || p.state == StatePaused {
		if p.cancelRun != nil {
			p.cancelRun()
		}
		p.mu.Unlock()
		p.wg.Wait()
		p.mu.Lock()
	}

	master, err := src.LoadMaster()
	if err != nil {
		return fmt.Errorf("load master: %w", err)
	}
	events, err := src.LoadEvents()
	if err != nil {
		return fmt.Errorf("load events: %w", err)
	}

	dsID := p.dataSourceID
	if err := p.truncateAll(dsID); err != nil {
		return fmt.Errorf("truncate all: %w", err)
	}
	if err := p.insertMaster(master, dsID); err != nil {
		return fmt.Errorf("insert master: %w", err)
	}

	p.src = src
	p.events = events
	p.cursor = 0
	p.state = StateLoaded
	return nil
}

// Play は再生を開始 / 一時停止から再開する。
func (p *Player) Play() error {
	p.mu.Lock()
	defer p.mu.Unlock()

	switch p.state {
	case StateLoaded, StatePaused:
		// OK
	case StateRunning:
		return fmt.Errorf("already running")
	default:
		return fmt.Errorf("cannot play in state %s", p.state)
	}

	ctx, cancel := context.WithCancel(context.Background())
	p.cancelRun = cancel
	p.state = StateRunning

	startCursor := p.cursor
	events := p.events
	dsID := p.dataSourceID
	normalizeTS := p.normalizeTimestamps

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		p.runLoop(ctx, events, startCursor, dsID, normalizeTS)
	}()
	return nil
}

// Pause は再生を一時停止する。
func (p *Player) Pause() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.state != StateRunning {
		return fmt.Errorf("not running")
	}
	if p.cancelRun != nil {
		p.cancelRun()
		p.cancelRun = nil
	}
	p.state = StatePaused
	return nil
}

// Reset はログテーブルをクリアしてカーソルを先頭に戻す。
func (p *Player) Reset() error {
	p.mu.Lock()
	if p.state == StateRunning {
		if p.cancelRun != nil {
			p.cancelRun()
		}
		p.mu.Unlock()
		p.wg.Wait()
		p.mu.Lock()
	}
	defer p.mu.Unlock()

	if p.src == nil {
		return fmt.Errorf("no source loaded")
	}
	dsID := p.dataSourceID
	if err := p.truncateLogs(dsID); err != nil {
		return err
	}
	p.cursor = 0
	p.state = StateLoaded
	return nil
}

// SetSpeed は速度倍率を変更する（再生中でも即時反映）。
func (p *Player) SetSpeed(v float64) error {
	if v < 0.1 || v > 100.0 {
		return fmt.Errorf("multiplier must be between 0.1 and 100.0")
	}
	p.setSpeed(v)
	return nil
}

// runLoop は仮想時計で events[startCursor:] を順次 INSERT する。
func (p *Player) runLoop(ctx context.Context, events []source.TimedEvent, startCursor int, dsID string, normalizeTS bool) {
	if len(events) == 0 || startCursor >= len(events) {
		p.mu.Lock()
		p.state = StateCompleted
		p.mu.Unlock()
		return
	}

	baseEventTime := events[0].EventTime
	playStartWall := time.Now()

	// 一時停止から再開した場合のウォール時計補正
	if startCursor > 0 {
		elapsed := events[startCursor-1].EventTime.Sub(baseEventTime)
		speed := p.getSpeed()
		pausedOffset := time.Duration(float64(elapsed) / speed)
		playStartWall = time.Now().Add(-pausedOffset)
	}

	for i := startCursor; i < len(events); i++ {
		ev := events[i]
		offsetFromBase := ev.EventTime.Sub(baseEventTime)
		speed := p.getSpeed()
		targetWallOffset := time.Duration(float64(offsetFromBase) / speed)
		sleepUntil := playStartWall.Add(targetWallOffset)

		delay := time.Until(sleepUntil)
		if delay > 0 {
			select {
			case <-ctx.Done():
				// Pause が呼ばれた：cursor を更新して返る
				p.mu.Lock()
				p.cursor = i
				if p.state == StateRunning {
					p.state = StatePaused
				}
				p.mu.Unlock()
				return
			case <-time.After(delay):
			}
		}

		if err := p.insertEvent(ev, dsID, normalizeTS); err != nil {
			log.Printf("insert error at event %d: %v", i, err)
			p.mu.Lock()
			p.cursor = i
			p.state = StateError
			p.mu.Unlock()
			return
		}

		p.mu.Lock()
		p.cursor = i + 1
		p.mu.Unlock()
	}

	p.mu.Lock()
	p.state = StateCompleted
	p.mu.Unlock()
}

// insertMaster はマスタデータを全テーブルに INSERT する（既存データは先に truncateAll 済み想定）。
func (p *Player) insertMaster(md *source.MasterData, dsID string) error {
	ctx := context.Background()
	for _, table := range source.MasterTables {
		rows, ok := md.Rows[table]
		if !ok || len(rows) == 0 {
			continue
		}
		if err := p.insertRows(ctx, table, rows, dsID); err != nil {
			return fmt.Errorf("insert %s: %w", table, err)
		}
	}
	return nil
}

// insertEvent は単一の TimedEvent を INSERT する。
func (p *Player) insertEvent(ev source.TimedEvent, dsID string, normalizeTS bool) error {
	row := ev.Row
	if normalizeTS {
		// INSERT 時の wall clock を event_time として使用（ビジュアライザーに現在時刻として見せるため）
		row = make(map[string]string, len(ev.Row))
		for k, v := range ev.Row {
			row[k] = v
		}
		row["event_time"] = time.Now().UTC().Format(time.RFC3339Nano)
	}
	return p.insertRows(context.Background(), ev.Table, []map[string]string{row}, dsID)
}

// insertRows は rows を指定テーブルに INSERT する。
// dsID が空でない場合は data_source_id カラムを自動付与する（central モード用）。
func (p *Player) insertRows(ctx context.Context, table string, rows []map[string]string, dsID string) error {
	if len(rows) == 0 {
		return nil
	}
	// カラム名をヘッダー行から取得
	cols := make([]string, 0, len(rows[0]))
	for k := range rows[0] {
		cols = append(cols, k)
	}
	if dsID != "" {
		cols = append(cols, "data_source_id")
	}

	conn, err := p.pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	for _, row := range rows {
		placeholders := make([]string, len(cols))
		vals := make([]any, len(cols))
		for i, col := range cols {
			placeholders[i] = fmt.Sprintf("$%d", i+1)
			if col == "data_source_id" {
				vals[i] = dsID
			} else {
				v := row[col]
				if v == "" {
					vals[i] = nil
				} else {
					vals[i] = v
				}
			}
		}
		q := fmt.Sprintf(
			"INSERT INTO %s (%s) VALUES (%s)",
			table,
			strings.Join(cols, ","),
			strings.Join(placeholders, ","),
		)
		if _, err := conn.Exec(ctx, q, vals...); err != nil {
			return fmt.Errorf("%s: %w", table, err)
		}
	}
	return nil
}

// truncateLogs はログテーブルをクリアする。
// central モード（dsID != ""）では TRUNCATE の代わりに DELETE WHERE data_source_id = $1 を使用する。
func (p *Player) truncateLogs(dsID string) error {
	ctx := context.Background()
	if dsID != "" {
		for _, table := range source.LogTables {
			if _, err := p.pool.Exec(ctx,
				fmt.Sprintf("DELETE FROM %s WHERE data_source_id = $1", table), dsID); err != nil {
				return err
			}
		}
		return nil
	}
	tables := strings.Join(source.LogTables, ", ")
	_, err := p.pool.Exec(ctx, fmt.Sprintf("TRUNCATE %s", tables))
	return err
}

// truncateAll はマスタ・ログ全テーブルをクリアする。
// central モード（dsID != ""）ではマスタは全件 DELETE、ログは data_source_id でフィルタ DELETE する。
// マスタテーブルの PK は data_source_id でスコープされないため全件クリアが必要。
func (p *Player) truncateAll(dsID string) error {
	ctx := context.Background()
	if dsID != "" {
		for _, table := range source.MasterTables {
			if _, err := p.pool.Exec(ctx, fmt.Sprintf("DELETE FROM %s", table)); err != nil {
				return err
			}
		}
		for _, table := range source.LogTables {
			if _, err := p.pool.Exec(ctx,
				fmt.Sprintf("DELETE FROM %s WHERE data_source_id = $1", table), dsID); err != nil {
				return err
			}
		}
		return nil
	}
	all := make([]string, 0, len(source.MasterTables)+len(source.LogTables))
	all = append(all, source.MasterTables...)
	all = append(all, source.LogTables...)
	tables := strings.Join(all, ", ")
	_, err := p.pool.Exec(ctx, fmt.Sprintf("TRUNCATE %s", tables))
	return err
}

// ConnectWithRetry は指数バックオフで最大 maxRetry 回接続を試みる。
func ConnectWithRetry(ctx context.Context, dsn string, maxRetry int) (*pgxpool.Pool, error) {
	var pool *pgxpool.Pool
	var err error
	for i := 0; i < maxRetry; i++ {
		pool, err = pgxpool.New(ctx, dsn)
		if err == nil {
			if pingErr := pool.Ping(ctx); pingErr == nil {
				return pool, nil
			} else {
				pool.Close()
				err = pingErr
			}
		}
		wait := time.Duration(math.Pow(2, float64(i))) * time.Second
		if wait > 30*time.Second {
			wait = 30 * time.Second
		}
		log.Printf("DB connect attempt %d/%d failed: %v. Retrying in %s...", i+1, maxRetry, err, wait)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(wait):
		}
	}
	return nil, fmt.Errorf("failed to connect after %d attempts: %w", maxRetry, err)
}
