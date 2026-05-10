package source

import _ "embed"

//go:embed scenario/default.zip
var defaultZipData []byte

func NewBuiltinSource() *ZipSource {
	return NewZipSource("builtin:Linear-3", defaultZipData)
}
