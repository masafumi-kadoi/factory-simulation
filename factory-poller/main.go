package main

import (
	"log"
	"net/http"
	"os"

	"factory-poller/internal/api"
	"factory-poller/internal/database"
	"factory-poller/internal/poller"
)

func main() {
	dsn := os.Getenv("INTERNAL_DB_DSN")
	if dsn == "" {
		dsn = "host=localhost port=5432 dbname=factory_simulation user=postgres password=postgres sslmode=disable"
	}
	port := os.Getenv("PORT")
	if port == "" {
		port = "8091"
	}

	db, err := database.New(dsn)
	if err != nil {
		log.Fatalf("failed to connect to internal DB: %v", err)
	}
	defer db.Close()

	mgr := poller.NewManager(db)
	h := api.NewHandler(mgr)

	mux := http.NewServeMux()
	h.RegisterRoutes(mux)

	log.Printf("factory-poller listening on :%s", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
