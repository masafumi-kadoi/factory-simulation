package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"simdb-test-driver/api"
	"simdb-test-driver/player"
	"simdb-test-driver/source"
)

func main() {
	dbHost := getenv("DB_HOST", "localhost")
	dbPort := getenv("DB_PORT", "5432")
	dbName := getenv("DB_NAME", "simdb_test")
	dbUser := getenv("DB_USER", "simdb")
	dbPass := getenv("DB_PASSWORD", "simdb")
	port := getenv("DRIVER_PORT", "8099")
	initialSpeed := getenvFloat("INITIAL_SPEED", 1.0)
	targetMode := getenv("TARGET_MODE", "standalone")
	gatewayURL := getenv("GATEWAY_URL", "")
	dataSourceID := getenv("DATA_SOURCE_ID", "")

	dsn := fmt.Sprintf("host=%s port=%s dbname=%s user=%s password=%s sslmode=disable",
		dbHost, dbPort, dbName, dbUser, dbPass)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	log.Printf("TARGET_MODE=%s", targetMode)
	log.Println("Connecting to DB...")
	pool, err := player.ConnectWithRetry(ctx, dsn, 10)
	if err != nil {
		log.Fatalf("DB connect failed: %v", err)
	}
	defer pool.Close()
	log.Println("Connected to DB.")

	p := player.New(pool)
	if err := p.SetSpeed(initialSpeed); err != nil {
		log.Printf("Warning: invalid INITIAL_SPEED %.2f, using 1.0", initialSpeed)
		p.SetSpeed(1.0)
	}

	if targetMode == "central" {
		// data_source_id を解決: 環境変数で明示指定 or Gateway API で自動発行
		if dataSourceID == "" {
			if gatewayURL == "" {
				log.Fatal("central モードには GATEWAY_URL または DATA_SOURCE_ID が必要です")
			}
			id, err := createDataSource(gatewayURL, "simdb-test-driver")
			if err != nil {
				log.Fatalf("Gateway から data_source_id を取得できませんでした: %v", err)
			}
			dataSourceID = id
			log.Printf("data_source_id を発行しました: %s", dataSourceID)
		} else {
			log.Printf("DATA_SOURCE_ID=%s を使用します", dataSourceID)
		}
		p.SetDataSourceID(dataSourceID)

		// タイムスタンプ正規化: central モードのデフォルトは true
		normalizeTS := os.Getenv("NORMALIZE_TIMESTAMPS") != "false"
		p.SetNormalizeTimestamps(normalizeTS)
		log.Printf("NORMALIZE_TIMESTAMPS=%v", normalizeTS)
	}

	// 起動時にビルトインシナリオを自動ロード
	log.Println("Loading builtin scenario...")
	if err := p.Load(source.NewBuiltinSource()); err != nil {
		log.Fatalf("Failed to load builtin scenario: %v", err)
	}
	log.Println("Builtin scenario loaded.")

	mux := http.NewServeMux()
	api.New(p).Register(mux)

	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}

	go func() {
		log.Printf("simdb-driver listening on :%s", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	<-ctx.Done()
	log.Println("Shutting down...")
	shutCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(shutCtx)
}

// createDataSource は Gateway の POST /api/data-sources を呼び出して data_source_id を取得する。
func createDataSource(gatewayURL, friendlyName string) (string, error) {
	body, _ := json.Marshal(map[string]string{
		"sourceType":   "simulation",
		"friendlyName": friendlyName,
	})
	resp, err := http.Post(gatewayURL+"/api/data-sources", "application/json", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		return "", fmt.Errorf("gateway returned HTTP %d", resp.StatusCode)
	}
	var ds struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&ds); err != nil {
		return "", err
	}
	if ds.ID == "" {
		return "", fmt.Errorf("gateway returned empty id")
	}
	return ds.ID, nil
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getenvFloat(key string, fallback float64) float64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	var f float64
	if _, err := fmt.Sscanf(v, "%f", &f); err != nil {
		return fallback
	}
	return f
}
