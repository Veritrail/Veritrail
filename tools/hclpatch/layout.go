package main

import (
	"path"
	"sort"
	"strings"
)

type LayoutRequest struct {
	UsesTerragrunt bool     `json:"uses_terragrunt"`
	Files          []TfFile `json:"files"`
}

type LayoutResponse struct {
	Status         string `json:"status"`
	Message        string `json:"message,omitempty"`
	TerraformPath  string `json:"terraform_path"`
	TerragruntPath string `json:"terragrunt_path"`
	PathsDiffer    bool   `json:"paths_differ"`
	FilesAnalyzed  int    `json:"files_analyzed"`
}

var terraformDirHints = []string{"modules", "terraform", "infra", "iac", "infrastructure"}
var terragruntDirHints = []string{"live", "environments", "env", "stacks", "terragrunt"}

func detectLayout(req LayoutRequest) LayoutResponse {
	if len(req.Files) == 0 {
		return LayoutResponse{
			Status:         "empty",
			Message:        "no .tf/.hcl files found",
			TerraformPath:  ".",
			TerragruntPath: ".",
		}
	}

	resourceDirs := map[string]int{}
	var terragruntDirs []string

	for _, f := range req.Files {
		p := normalizePath(f.Path)
		if p == "" || strings.Contains(p, "/.terraform/") || strings.HasPrefix(p, ".") {
			continue
		}
		dir := parentDir(p)
		base := path.Base(p)
		if base == "terragrunt.hcl" {
			terragruntDirs = append(terragruntDirs, dir)
			continue
		}
		if strings.HasSuffix(p, ".tf") {
			n := len(parseAllResources([]TfFile{{Path: p, Content: f.Content}}))
			if n > 0 {
				resourceDirs[dir] += n
			}
		}
	}

	terraformPath := pickTerraformDir(resourceDirs)
	terragruntPath := terraformPath
	if req.UsesTerragrunt && len(terragruntDirs) > 0 {
		terragruntPath = pickTerragruntDir(terragruntDirs)
	}

	return LayoutResponse{
		Status:         "ok",
		TerraformPath:  terraformPath,
		TerragruntPath: terragruntPath,
		PathsDiffer:    terragruntPath != terraformPath,
		FilesAnalyzed:  len(req.Files),
	}
}

func normalizePath(p string) string {
	return strings.TrimPrefix(strings.ReplaceAll(strings.TrimSpace(p), "\\", "/"), "./")
}

func parentDir(p string) string {
	if !strings.Contains(p, "/") {
		return "."
	}
	return strings.TrimSuffix(p, "/"+path.Base(p))
}

func pickTerraformDir(counts map[string]int) string {
	if len(counts) == 0 {
		return "."
	}
	if counts["."] > 0 {
		return "."
	}
	for _, hint := range terraformDirHints {
		if match := hintDirRoot(counts, hint); match != "" {
			return match
		}
	}
	return shallowestBusiestDir(counts)
}

func hintDirRoot(counts map[string]int, hint string) string {
	found := false
	for dir := range counts {
		if dirMatchesHint(dir, hint) {
			found = true
			break
		}
	}
	if !found {
		return ""
	}
	return hint
}

func dirMatchesHint(dir, hint string) bool {
	if dir == hint {
		return true
	}
	if strings.HasPrefix(dir, hint+"/") {
		return true
	}
	return strings.Contains(dir, "/"+hint+"/") || strings.HasSuffix(dir, "/"+hint)
}

func pickTerragruntDir(dirs []string) string {
	if len(dirs) == 0 {
		return "."
	}
	sort.Strings(dirs)
	for _, hint := range terragruntDirHints {
		for _, d := range dirs {
			if dirMatchesHint(d, hint) {
				return hint
			}
		}
	}
	if len(dirs) == 1 {
		return dirs[0]
	}
	return commonPathPrefix(dirs)
}

func commonPathPrefix(dirs []string) string {
	if len(dirs) == 0 {
		return "."
	}
	parts := strings.Split(dirs[0], "/")
	for i := len(parts); i > 0; i-- {
		prefix := strings.Join(parts[:i], "/")
		if prefix == "" {
			continue
		}
		all := true
		for _, d := range dirs {
			if d != prefix && !strings.HasPrefix(d, prefix+"/") {
				all = false
				break
			}
		}
		if all {
			return prefix
		}
	}
	return dirs[0]
}

func shallowestBusiestDir(counts map[string]int) string {
	type row struct {
		dir   string
		count int
		depth int
	}
	rows := make([]row, 0, len(counts))
	for dir, count := range counts {
		rows = append(rows, row{dir: dir, count: count, depth: strings.Count(dir, "/")})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].depth != rows[j].depth {
			return rows[i].depth < rows[j].depth
		}
		return rows[i].count > rows[j].count
	})
	return rows[0].dir
}
