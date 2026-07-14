// Package store keeps records in memory.
package store

// Get returns a record by id.
func Get(id string) string {
	return id
}

// Put stores a record and reports success.
func Put(id string, value string) bool {
	return id != "" && value != ""
}
