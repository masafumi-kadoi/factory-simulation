package source

import (
	"archive/zip"
	"bytes"
	"fmt"
	"path/filepath"
	"strings"
)

type ZipSource struct {
	name string
	data []byte // ZIP バイト列
}

func NewZipSource(name string, data []byte) *ZipSource {
	return &ZipSource{name: name, data: data}
}

func (s *ZipSource) Name() string { return s.name }

func (s *ZipSource) LoadMaster() (*MasterData, error) {
	csvFiles, err := s.readAll()
	if err != nil {
		return nil, err
	}
	md := &MasterData{Rows: make(map[string][]map[string]string)}
	for _, table := range MasterTables {
		if rows, ok := csvFiles[table]; ok {
			md.Rows[table] = rows
		}
	}
	return md, nil
}

func (s *ZipSource) LoadEvents() ([]TimedEvent, error) {
	csvFiles, err := s.readAll()
	if err != nil {
		return nil, err
	}
	var all []TimedEvent
	for _, table := range LogTables {
		rows, ok := csvFiles[table]
		if !ok {
			continue
		}
		events, err := rowsToEvents(table, rows)
		if err != nil {
			return nil, err
		}
		all = append(all, events...)
	}
	sortEvents(all)
	return all, nil
}

// readAll は ZIP 内の全 CSV ファイルを読み込んでテーブル名→行スライスのマップを返す。
func (s *ZipSource) readAll() (map[string][]map[string]string, error) {
	r, err := zip.NewReader(bytes.NewReader(s.data), int64(len(s.data)))
	if err != nil {
		return nil, fmt.Errorf("open zip: %w", err)
	}
	result := make(map[string][]map[string]string)
	for _, f := range r.File {
		if f.FileInfo().IsDir() {
			continue
		}
		base := filepath.Base(f.Name)
		if !strings.HasSuffix(base, ".csv") {
			continue
		}
		table := strings.TrimSuffix(base, ".csv")
		rc, err := f.Open()
		if err != nil {
			return nil, fmt.Errorf("open %s: %w", f.Name, err)
		}
		rows, err := parseCSV(rc)
		rc.Close()
		if err != nil {
			return nil, fmt.Errorf("parse %s: %w", f.Name, err)
		}
		result[table] = rows
	}
	return result, nil
}
