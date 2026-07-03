package main

import (
	"encoding/json"
	"fmt"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: hclpatch patch < request.json")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "scan":
		var req ScanRequest
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			fail(err)
		}
		emit(scanRequest(req))
	case "patch":
		var req PatchRequest
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			fail(err)
		}
		out := patchRequest(req)
		emit(out)
	case "detect-layout":
		var req LayoutRequest
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			fail(err)
		}
		emit(detectLayout(req))
	case "validate-syntax":
		var req struct {
			Files []TfFile `json:"files"`
		}
		if err := json.NewDecoder(os.Stdin).Decode(&req); err != nil {
			fail(err)
		}
		if err := validateSyntax(req.Files); err != nil {
			emit(map[string]any{"ok": false, "error": err.Error()})
			os.Exit(1)
		}
		emit(map[string]any{"ok": true})
	default:
		fmt.Fprintln(os.Stderr, "unknown command:", os.Args[1])
		os.Exit(2)
	}
}

func emit(v any) {
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func fail(err error) {
	emit(map[string]string{"status": "error", "message": err.Error()})
	os.Exit(1)
}
