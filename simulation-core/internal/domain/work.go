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
	QualityStatus QualityStatus
	ParentWorkIDs []string // Parent work IDs for traceability (used in Merge stations)
	OriginWorkID  string   // Origin work ID for traceability (used in Split stations)
}

// NewWork creates a new work with unknown quality status
func NewWork(id string) *Work {
	return &Work{
		ID:            id,
		QualityStatus: QualityUnknown,
	}
}
