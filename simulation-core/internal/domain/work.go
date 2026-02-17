package domain

// QualityStatus represents the quality status of a work
type QualityStatus string

const (
	QualityOK      QualityStatus = "OK"
	QualityNG      QualityStatus = "NG"
	QualityUnknown QualityStatus = "未判定"
)

// Work represents a work item in the simulation
type Work struct {
	ID            string
	Type          string                 // Work type (e.g. "partA", "partB", "assembly-AB")
	FriendlyName  string
	QualityStatus QualityStatus
	Metadata      map[string]interface{} // Extended info (mergedFrom, splitFrom, etc.)
	// Traceability information is now managed externally in work_lineage table
}

// NewWork creates a new work with unknown quality status
func NewWork(id, friendlyName string) *Work {
	return &Work{
		ID:            id,
		FriendlyName:  friendlyName,
		QualityStatus: QualityUnknown,
	}
}

// NewWorkWithType creates a new work with a specified type
func NewWorkWithType(id, friendlyName, workType string) *Work {
	return &Work{
		ID:            id,
		Type:          workType,
		FriendlyName:  friendlyName,
		QualityStatus: QualityUnknown,
	}
}
