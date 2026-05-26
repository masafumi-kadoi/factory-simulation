package poller

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"sync"
	"time"

	"factory-poller/internal/database"
)

// Config holds the configuration for one factory poller.
type Config struct {
	FactoryID          string
	ExternalDBHost     string
	ExternalDBPort     int
	ExternalDBName     string
	ExternalDBUser     string
	ExternalDBPass     string
	ExternalDSID       string // data_source_id in the external DB to poll
	InternalDataSourceID string
}

// Manager manages poller goroutines keyed by factory ID.
type Manager struct {
	mu      sync.Mutex
	running map[string]*instance
	db      *database.DB
}

type instance struct {
	cfg    Config
	cancel context.CancelFunc
	done   chan struct{}
}

func NewManager(db *database.DB) *Manager {
	return &Manager{
		running: make(map[string]*instance),
		db:      db,
	}
}

// Start begins polling for a factory. Idempotent: returns existing dsID if already running.
func (m *Manager) Start(cfg Config) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if inst, ok := m.running[cfg.FactoryID]; ok {
		return inst.cfg.InternalDataSourceID, nil // already running
	}

	// Reuse or create internal data_source
	dsID := cfg.InternalDataSourceID
	if dsID == "" {
		existing, err := m.db.GetActiveRealtimeDataSource(cfg.FactoryID)
		if err != nil {
			return "", fmt.Errorf("check existing data source: %w", err)
		}
		if existing != "" {
			dsID = existing
		} else {
			label := fmt.Sprintf("RealFactory_%s", time.Now().Format("2006-01-02T15:04:05"))
			newID, err := m.db.CreateRealtimeDataSource(cfg.FactoryID, label)
			if err != nil {
				return "", fmt.Errorf("create realtime data source: %w", err)
			}
			dsID = newID
		}
	}
	cfg.InternalDataSourceID = dsID

	ctx, cancel := context.WithCancel(context.Background())
	inst := &instance{
		cfg:    cfg,
		cancel: cancel,
		done:   make(chan struct{}),
	}
	m.running[cfg.FactoryID] = inst

	go m.run(ctx, inst)
	log.Printf("[poller] started for factory=%s dsID=%s", cfg.FactoryID, dsID)
	return dsID, nil
}

// Stop stops polling for a factory.
func (m *Manager) Stop(factoryID string) error {
	m.mu.Lock()
	inst, ok := m.running[factoryID]
	if !ok {
		m.mu.Unlock()
		return nil
	}
	delete(m.running, factoryID)
	m.mu.Unlock()

	inst.cancel()
	<-inst.done

	if err := m.db.EndDataSource(inst.cfg.InternalDataSourceID); err != nil {
		log.Printf("[poller] warn: failed to set ended_at for %s: %v", inst.cfg.InternalDataSourceID, err)
	}
	log.Printf("[poller] stopped for factory=%s", factoryID)
	return nil
}

// Status returns (running, internalDataSourceID).
func (m *Manager) Status(factoryID string) (bool, string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if inst, ok := m.running[factoryID]; ok {
		return true, inst.cfg.InternalDataSourceID
	}
	return false, ""
}

func (m *Manager) run(ctx context.Context, inst *instance) {
	defer close(inst.done)
	cfg := inst.cfg

	// Connect to external DB
	extDB, err := database.ConnectExternal(cfg.ExternalDBHost, cfg.ExternalDBPort, cfg.ExternalDBName, cfg.ExternalDBUser, cfg.ExternalDBPass)
	if err != nil {
		log.Printf("[poller] failed to connect to external DB for factory=%s: %v", cfg.FactoryID, err)
		return
	}
	defer extDB.Close()

	// Register locations once at startup
	locMap, err := m.setupLocations(extDB, cfg)
	if err != nil {
		log.Printf("[poller] failed to setup locations for factory=%s: %v", cfg.FactoryID, err)
		return
	}

	// Resume from latest event in internal DB
	lastTime, err := m.db.GetLatestEventTime(cfg.InternalDataSourceID)
	if err != nil {
		log.Printf("[poller] warn: could not get latest event time: %v", err)
		lastTime = time.Now().Add(-24 * time.Hour)
	}

	ticker := time.NewTicker(1 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			pollTime := time.Now()
			rows, err := database.FetchExternalMovements(extDB, cfg.ExternalDSID, lastTime)
			if err != nil {
				log.Printf("[poller] poll error factory=%s: %v", cfg.FactoryID, err)
				// Try to reconnect on next tick
				extDB.Close()
				extDB, err = database.ConnectExternal(cfg.ExternalDBHost, cfg.ExternalDBPort, cfg.ExternalDBName, cfg.ExternalDBUser, cfg.ExternalDBPass)
				if err != nil {
					log.Printf("[poller] reconnect failed factory=%s: %v", cfg.FactoryID, err)
				}
				continue
			}
			if len(rows) > 0 {
				// Ensure item_master entries exist
				itemIDs := uniqueItemIDs(rows)
				if err := m.db.EnsureItemMaster(cfg.InternalDataSourceID, itemIDs); err != nil {
					log.Printf("[poller] item_master error: %v", err)
				}
				if err := m.db.InsertMovements(cfg.InternalDataSourceID, rows, locMap); err != nil {
					log.Printf("[poller] insert error factory=%s: %v", cfg.FactoryID, err)
				} else {
					log.Printf("[poller] factory=%s inserted %d events", cfg.FactoryID, len(rows))
				}
				lastTime = pollTime
			}
		}
	}
}

func (m *Manager) setupLocations(extDB *sql.DB, cfg Config) (map[int64]int64, error) {
	locs, err := database.FetchExternalLocations(extDB, cfg.ExternalDSID)
	if err != nil {
		return nil, fmt.Errorf("fetch external locations: %w", err)
	}
	if len(locs) == 0 {
		// No location_master in external DB - return empty map, use direct IDs
		log.Printf("[poller] factory=%s: no location_master found in external DB, IDs will be used as-is", cfg.FactoryID)
		return map[int64]int64{}, nil
	}
	locMap, err := m.db.RegisterLocations(cfg.InternalDataSourceID, locs)
	if err != nil {
		return nil, fmt.Errorf("register locations: %w", err)
	}
	log.Printf("[poller] factory=%s: registered %d locations", cfg.FactoryID, len(locMap))
	return locMap, nil
}

func uniqueItemIDs(rows []database.MovementRow) []string {
	seen := make(map[string]struct{})
	var ids []string
	for _, r := range rows {
		if _, ok := seen[r.ItemID]; !ok {
			seen[r.ItemID] = struct{}{}
			ids = append(ids, r.ItemID)
		}
	}
	return ids
}
