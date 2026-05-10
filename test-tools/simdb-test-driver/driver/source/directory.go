package source

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
)

type DirectorySource struct {
	dir string
}

func NewDirectorySource(dir string) *DirectorySource {
	return &DirectorySource{dir: dir}
}

func (s *DirectorySource) Name() string { return "directory:" + s.dir }

func (s *DirectorySource) LoadMaster() (*MasterData, error) {
	md := &MasterData{Rows: make(map[string][]map[string]string)}
	for _, table := range MasterTables {
		rows, err := s.readTable(table)
		if err != nil {
			return nil, err
		}
		if rows != nil {
			md.Rows[table] = rows
		}
	}
	return md, nil
}

func (s *DirectorySource) LoadEvents() ([]TimedEvent, error) {
	var all []TimedEvent
	for _, table := range LogTables {
		rows, err := s.readTable(table)
		if err != nil {
			return nil, err
		}
		if rows == nil {
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

func (s *DirectorySource) readTable(table string) ([]map[string]string, error) {
	path := filepath.Join(s.dir, table+".csv")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read %s: %w", path, err)
	}
	rows, err := parseCSV(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}
	return rows, nil
}
