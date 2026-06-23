package main

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/hashicorp/hcl/v2"
	"github.com/hashicorp/hcl/v2/hclsyntax"
)

func parseConfig(f TfFile) (*hcl.File, hcl.Diagnostics) {
	return hclsyntax.ParseConfig([]byte(f.Content), f.Path, hcl.Pos{Line: 1, Column: 1})
}

type PatchRequest struct {
	CheckID    string   `json:"check_id"`
	BucketName string   `json:"bucket_name,omitempty"`
	KeyID      string   `json:"key_id,omitempty"`
	GroupID    string   `json:"group_id,omitempty"`
	GroupName  string   `json:"group_name,omitempty"`
	// New fields for expanded check types
	InstanceID   string   `json:"instance_id,omitempty"`
	TopicName    string   `json:"topic_name,omitempty"`
	QueueName    string   `json:"queue_name,omitempty"`
	RepoName     string   `json:"repo_name,omitempty"`
	VpcID        string   `json:"vpc_id,omitempty"`
	FunctionName string   `json:"function_name,omitempty"`
	LbName       string   `json:"lb_name,omitempty"`
	Files        []TfFile `json:"files"`
}

type PatchResponse struct {
	Status         string          `json:"status"`
	Message        string          `json:"message,omitempty"`
	CheckID        string          `json:"check_id,omitempty"`
	FilePath       string          `json:"file_path,omitempty"`
	Action         string          `json:"action,omitempty"`
	SuggestedHCL   string          `json:"suggested_hcl,omitempty"`
	PatchedContent string          `json:"patched_content,omitempty"`
	Matches        []ResourceMatch `json:"matches,omitempty"`
}

var (
	resourceHead = regexp.MustCompile(`resource\s+"([^"]+)"\s+"([^"]+)"\s*\{`)
	bucketAttr   = regexp.MustCompile(`(?m)^\s*bucket\s*=\s*"([^"]+)"`)
)

func patchRequest(req PatchRequest) PatchResponse {
	scan := scanRequest(ScanRequest{
		CheckID:      req.CheckID,
		BucketName:   req.BucketName,
		KeyID:        req.KeyID,
		GroupID:      req.GroupID,
		GroupName:    req.GroupName,
		InstanceID:   req.InstanceID,
		TopicName:    req.TopicName,
		QueueName:    req.QueueName,
		RepoName:     req.RepoName,
		VpcID:        req.VpcID,
		FunctionName: req.FunctionName,
		LbName:       req.LbName,
		Files:        req.Files,
	})
	if scan.Status == "not_found" {
		return PatchResponse{Status: "not_found", Message: scan.Message, CheckID: req.CheckID}
	}
	if scan.Status == "unsupported" || scan.Status == "error" {
		return PatchResponse{Status: scan.Status, Message: scan.Message, CheckID: req.CheckID}
	}

	switch req.CheckID {
	case "s3.bucket.public_access_not_blocked":
		return patchS3PublicAccess(req, scan.Matches)
	case "kms.key.no_rotation":
		return patchKmsRotation(req, scan.Matches)
	case "ec2.security_group.unrestricted_ssh", "ec2.security_group.unrestricted_rdp":
		return PatchResponse{
			Status:  "repo_context_required",
			CheckID: req.CheckID,
			Message: "Security group ingress is imperative — use EventBridge or CLI. Terraform match(es) listed for manual review.",
			Matches: scan.Matches,
		}
	// Phase 1A — easy attribute toggles
	case "rds.instance.no_storage_encryption":
		return patchRdsEncryption(req, scan.Matches)
	case "rds.instance.publicly_accessible":
		return patchRdsPublic(req, scan.Matches)
	case "sns.topic.no_encryption":
		return patchSnsEncryption(req, scan.Matches)
	case "sqs.queue.no_encryption":
		return patchSqsEncryption(req, scan.Matches)
	case "guardduty.detector.disabled":
		return patchGuardDuty(req, scan.Matches)
	case "ec2.ebs.encryption_not_default":
		return patchEbsDefaultEncryption(req, scan.Matches)
	case "iam.account.password_policy_weak":
		return patchPasswordPolicy(req, scan.Matches)
	case "ecr.repository.image_scan_disabled":
		return patchEcrScanning(req, scan.Matches)
	// Phase 1B — block insertions
	case "s3.bucket.default_encryption_disabled":
		return patchS3DefaultEncryption(req, scan.Matches)
	case "cloudtrail.trail.not_enabled":
		return patchCloudTrail(req, scan.Matches)
	case "elb.access_logs_disabled":
		return patchElbAccessLogs(req, scan.Matches)
	// Phase 2 — complex
	case "s3.bucket.no_https_policy":
		return patchS3HttpsPolicy(req, scan.Matches)
	case "lambda.function.env_vars_unencrypted":
		return patchLambdaEnvEncryption(req, scan.Matches)
	case "ec2.vpc.no_flow_logs":
		return patchVpcFlowLogs(req, scan.Matches)
	case "kms.key.policy_wildcard_principal":
		return patchKmsWildcard(req, scan.Matches)
	default:
		return PatchResponse{Status: "unsupported", CheckID: req.CheckID, Message: "HCL patch not implemented for this check"}
	}
}

// ── Existing patch functions ────────────────────────────────────────────────

func patchS3PublicAccess(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if req.BucketName == "" && len(matches) == 0 {
		return PatchResponse{Status: "error", Message: "bucket_name required"}
	}
	bucketRes := matches[0].ResourceBlock
	bucketName := bucketRes.Name

	snippet := fmt.Sprintf(`resource "aws_s3_bucket_public_access_block" "%s" {
  bucket = aws_s3_bucket.%s.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
`, bucketName, bucketName)

	resources := parseAllResources(req.Files)
	for _, f := range req.Files {
		for _, r := range resources {
			if r.Type != "aws_s3_bucket_public_access_block" || r.FilePath != f.Path {
				continue
			}
			if strings.Contains(r.Body, bucketName) {
				replacement := strings.TrimSuffix(snippet, "\n")
				patched := replaceResourceBlock(f.Content, r, replacement)
				return PatchResponse{
					Status: "modify_existing", FilePath: f.Path,
					Action: "Update aws_s3_bucket_public_access_block", SuggestedHCL: snippet,
					PatchedContent: patched, Matches: matches,
				}
			}
		}
	}

	return PatchResponse{
		Status: "create_new", FilePath: bucketRes.FilePath,
		Action: "Append aws_s3_bucket_public_access_block", SuggestedHCL: snippet,
		PatchedContent: strings.TrimSpace(bucketRes.File) + "\n\n" + snippet, Matches: matches,
	}
}

func patchKmsRotation(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no aws_kms_key match"}
	}
	r := matches[0].ResourceBlock
	if strings.Contains(r.Body, "enable_key_rotation") {
		re := regexp.MustCompile(`enable_key_rotation\s*=\s*false`)
		newBody := re.ReplaceAllString(r.Body, "enable_key_rotation = true")
		if newBody != r.Body {
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Set enable_key_rotation = true",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
	}
	// inject attribute before closing brace
	trimmed := strings.TrimRight(r.Body, " \n}")
	newBody := trimmed + "\n  enable_key_rotation = true\n}"
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add enable_key_rotation = true",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

// ── Phase 1A: Easy attribute toggles ─────────────────────────────────────────

func patchRdsEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no RDS resource match"}
	}
	r := matches[0].ResourceBlock
	if strings.Contains(r.Body, "storage_encrypted") {
		re := regexp.MustCompile(`storage_encrypted\s*=\s*false`)
		newBody := re.ReplaceAllString(r.Body, "storage_encrypted = true")
		if newBody != r.Body {
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Set storage_encrypted = true",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
	}
	trimmed := strings.TrimRight(r.Body, " \n}")
	newBody := trimmed + "\n  storage_encrypted = true\n}"
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add storage_encrypted = true",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

func patchRdsPublic(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no RDS resource match"}
	}
	r := matches[0].ResourceBlock
	// Replace both string and boolean forms
	re := regexp.MustCompile(`publicly_accessible\s*=\s*(?:true|"true")`)
	newBody := re.ReplaceAllString(r.Body, "publicly_accessible = false")
	if newBody == r.Body {
		return PatchResponse{Status: "not_found", Message: "publicly_accessible = true not found in resource"}
	}
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Set publicly_accessible = false",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

func patchSnsEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no SNS topic match"}
	}
	r := matches[0].ResourceBlock
	trimmed := strings.TrimRight(r.Body, " \n}")
	newBody := trimmed + "\n  kms_master_key_id = \"alias/aws/sns\"\n}"
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add kms_master_key_id = \"alias/aws/sns\"",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

func patchSqsEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no SQS queue match"}
	}
	r := matches[0].ResourceBlock
	trimmed := strings.TrimRight(r.Body, " \n}")
	// Prefer sqs_managed_sse_enabled (AWS provider >= 5.x) as simpler alternative
	newBody := trimmed + "\n  sqs_managed_sse_enabled = true\n}"
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add sqs_managed_sse_enabled = true",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

func patchGuardDuty(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no resources found"}
	}
	r := matches[0].ResourceBlock

	// Check if match is against an existing disabled detector
	if r.Type == "aws_guardduty_detector" {
		if strings.Contains(r.Body, "enable = false") {
			re := regexp.MustCompile(`enable\s*=\s*false`)
			newBody := re.ReplaceAllString(r.Body, "enable = true")
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Set enable = true",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
	}

	// create_new — generate detector singleton
	snippet := `resource "aws_guardduty_detector" "this" {
  enable = true
  finding_publishing_frequency = "SIX_HOURS"
}`
	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create aws_guardduty_detector",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchEbsDefaultEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no resources found"}
	}
	r := matches[0].ResourceBlock

	// modify_existing if we found a disabled one
	if r.Type == "aws_ebs_encryption_by_default" {
		if strings.Contains(r.Body, "enabled = false") {
			re := regexp.MustCompile(`enabled\s*=\s*false`)
			newBody := re.ReplaceAllString(r.Body, "enabled = true")
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Set enabled = true",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
	}

	// create_new
	snippet := `resource "aws_ebs_encryption_by_default" "this" {
  enabled = true
}`
	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create aws_ebs_encryption_by_default",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchPasswordPolicy(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no resources found"}
	}
	r := matches[0].ResourceBlock

	// modify_existing if we found a weak one
	if r.Type == "aws_iam_account_password_policy" {
		newBody := r.Body

		// Fix min_length if below 14
		reMinLen := regexp.MustCompile(`minimum_password_length\s*=\s*\d+`)
		if reMinLen.MatchString(newBody) {
			newBody = reMinLen.ReplaceAllString(newBody, "minimum_password_length = 14")
		} else {
			trimmed := strings.TrimRight(newBody, " \n}")
			newBody = trimmed + "\n  minimum_password_length = 14\n}"
		}

		// Fix require_* flags
		for _, flag := range []string{"require_lowercase_characters", "require_uppercase_characters", "require_numbers", "require_symbols"} {
			reFlag := regexp.MustCompile(fmt.Sprintf(`%s\s*=\s*false`, flag))
			if reFlag.MatchString(newBody) {
				newBody = reFlag.ReplaceAllString(newBody, fmt.Sprintf("%s = true", flag))
			} else if !strings.Contains(newBody, flag) {
				trimmed := strings.TrimRight(newBody, " \n}")
				newBody = trimmed + fmt.Sprintf("\n  %s = true\n}", flag)
			}
		}

		// Fix reuse_prevention if < 24
		reReuse := regexp.MustCompile(`password_reuse_prevention\s*=\s*\d+`)
		if reReuse.MatchString(newBody) {
			newBody = reReuse.ReplaceAllString(newBody, "password_reuse_prevention = 24")
		} else if !strings.Contains(newBody, "password_reuse_prevention") {
			trimmed := strings.TrimRight(newBody, " \n}")
			newBody = trimmed + "\n  password_reuse_prevention = 24\n}"
		}

		// Fix max_age if 0
		reAge := regexp.MustCompile(`max_password_age\s*=\s*0`)
		if reAge.MatchString(newBody) {
			newBody = reAge.ReplaceAllString(newBody, "max_password_age = 90")
		}

		if newBody != r.Body {
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Strengthen password policy to CIS-compliant settings",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
		// No changes needed — already compliant
		return PatchResponse{
			Status:  "not_found",
			Message: "password policy already meets minimum security requirements",
		}
	}

	// create_new
	snippet := `resource "aws_iam_account_password_policy" "strict" {
  minimum_password_length        = 14
  require_lowercase_characters   = true
  require_uppercase_characters   = true
  require_numbers                = true
  require_symbols                = true
  allow_users_to_change_password = true
  max_password_age               = 90
  password_reuse_prevention      = 24
}`
	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create aws_iam_account_password_policy",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchEcrScanning(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no ECR repository match"}
	}
	r := matches[0].ResourceBlock

	if strings.Contains(r.Body, "image_scanning_configuration") {
		// Has the block — flip scan_on_push to true
		re := regexp.MustCompile(`scan_on_push\s*=\s*false`)
		newBody := re.ReplaceAllString(r.Body, "scan_on_push = true")
		if newBody != r.Body {
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Set scan_on_push = true in image_scanning_configuration",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
		// scan_on_push already true — no change
		return PatchResponse{
			Status:  "not_found",
			Message: "image_scanning_configuration already has scan_on_push = true",
		}
	}

	// Inject image_scanning_configuration block before closing brace
	trimmed := strings.TrimRight(r.Body, " \n}")
	newBody := trimmed + `

  image_scanning_configuration {
    scan_on_push = true
  }
}`
	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add image_scanning_configuration block with scan_on_push = true",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

// ── Phase 1B: Block insertions ──────────────────────────────────────────────

func patchS3DefaultEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if req.BucketName == "" && len(matches) == 0 {
		return PatchResponse{Status: "error", Message: "bucket_name required"}
	}
	r := matches[0].ResourceBlock

	// Check if match is against an existing SSE config (modify_existing)
	if r.Type == "aws_s3_bucket_server_side_encryption_configuration" {
		// Add a rule with AES256
		if strings.Contains(r.Body, "rule {") {
			// Has a rule block but no encryption — add sse_algorithm
			if !strings.Contains(r.Body, "sse_algorithm") {
				trimmed := strings.TrimRight(r.Body, " \n}")
				newBody := trimmed + `

    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}`
				return PatchResponse{
					Status: "modify_existing", FilePath: r.FilePath,
					Action:         "Add AES256 encryption rule to existing SSE config",
					SuggestedHCL:   newBody,
					PatchedContent: replaceResourceBlock(r.File, r, newBody),
					Matches:        matches,
				}
			}
		}
		// Has no rule block — add one complete
		trimmed := strings.TrimRight(r.Body, " \n}")
		newBody := trimmed + `

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}`
		return PatchResponse{
			Status: "modify_existing", FilePath: r.FilePath,
			Action:         "Add SSE-S3 encryption rule",
			SuggestedHCL:   newBody,
			PatchedContent: replaceResourceBlock(r.File, r, newBody),
			Matches:        matches,
		}
	}

	// create_new — generate SSE config resource
	bucketName := r.Name
	snippet := fmt.Sprintf(`resource "aws_s3_bucket_server_side_encryption_configuration" "%s" {
  bucket = aws_s3_bucket.%s.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}
`, bucketName, bucketName)

	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create aws_s3_bucket_server_side_encryption_configuration",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchCloudTrail(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no resources found"}
	}
	r := matches[0].ResourceBlock

	// modify_existing if a trail was found
	if r.Type == "aws_cloudtrail" {
		newBody := r.Body

		// Fix enable_logging
		reLogging := regexp.MustCompile(`enable_logging\s*=\s*false`)
		if reLogging.MatchString(newBody) {
			newBody = reLogging.ReplaceAllString(newBody, "enable_logging = true")
		} else if !strings.Contains(newBody, "enable_logging") {
			trimmed := strings.TrimRight(newBody, " \n}")
			newBody = trimmed + "\n  enable_logging = true\n}"
		}

		// Fix is_multi_region_trail
		reMulti := regexp.MustCompile(`is_multi_region_trail\s*=\s*false`)
		if reMulti.MatchString(newBody) {
			newBody = reMulti.ReplaceAllString(newBody, "is_multi_region_trail = true")
		} else if !strings.Contains(newBody, "is_multi_region_trail") {
			trimmed := strings.TrimRight(newBody, " \n}")
			newBody = trimmed + "\n  is_multi_region_trail = true\n}"
		}

		// Fix log file validation
		if !strings.Contains(newBody, "enable_log_file_validation") {
			trimmed := strings.TrimRight(newBody, " \n}")
			newBody = trimmed + "\n  enable_log_file_validation = true\n}"
		}

		if newBody != r.Body {
			return PatchResponse{
				Status: "modify_existing", FilePath: r.FilePath,
				Action:         "Configure existing CloudTrail with best-practice settings",
				SuggestedHCL:   newBody,
				PatchedContent: replaceResourceBlock(r.File, r, newBody),
				Matches:        matches,
			}
		}
		// Already compliant
		return PatchResponse{
			Status:  "not_found",
			Message: "existing cloudtrail is already properly configured",
		}
	}

	// create_new — generate CloudTrail + S3 bucket + PAB + bucket policy
	snippet := `resource "aws_s3_bucket" "cloudtrail_logs" {
  bucket = "${var.aws_account_id}-cloudtrail-logs"
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  bucket                  = aws_s3_bucket.cloudtrail_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  bucket = aws_s3_bucket.cloudtrail_logs.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AWSCloudTrailAclCheck"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:GetBucketAcl"
        Resource  = aws_s3_bucket.cloudtrail_logs.arn
      },
      {
        Sid       = "AWSCloudTrailWrite"
        Effect    = "Allow"
        Principal = { Service = "cloudtrail.amazonaws.com" }
        Action    = "s3:PutObject"
        Resource  = "${aws_s3_bucket.cloudtrail_logs.arn}/*"
        Condition = {
          StringEquals = { "s3:x-amz-acl" = "bucket-owner-full-control" }
        }
      }
    ]
  })
}

resource "aws_cloudtrail" "this" {
  name                          = "veritrail-multi-region-trail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs.id
  enable_logging                = true
  enable_log_file_validation    = true
  is_multi_region_trail         = true
  include_global_service_events = true
}`

	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create CloudTrail with S3 bucket, PAB, and bucket policy",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchElbAccessLogs(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no load balancer match"}
	}
	r := matches[0].ResourceBlock

	// Inject access_logs block before closing brace
	trimmed := strings.TrimRight(r.Body, " \n}")
	newBody := trimmed + `

  access_logs {
    enabled = true
    bucket  = aws_s3_bucket.lb_logs.bucket
  }
}`

	_ = req.LbName // used in scan, not needed in patch

	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add access_logs block (bucket reference: aws_s3_bucket.lb_logs.bucket)",
		SuggestedHCL:   newBody,
		PatchedContent: replaceResourceBlock(r.File, r, newBody),
		Matches:        matches,
	}
}

// ── Phase 2: Complex / context-dependent ─────────────────────────────────────

func patchS3HttpsPolicy(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if req.BucketName == "" && len(matches) == 0 {
		return PatchResponse{Status: "error", Message: "bucket_name required"}
	}
	r := matches[0].ResourceBlock

	// If match is against an existing bucket_policy (not the bucket itself), return repo_context_required
	if r.Type == "aws_s3_bucket_policy" {
		return PatchResponse{
			Status:  "repo_context_required",
			CheckID: req.CheckID,
			Message: "Existing bucket policy found — manually merge the DenyInsecureTransport statement to avoid clobbering other policy statements.",
			Matches: matches,
		}
	}

	// create_new — generate HTTPS-only bucket policy
	bucketName := r.Name
	snippet := fmt.Sprintf(`resource "aws_s3_bucket_policy" "%s_https_only" {
  bucket = aws_s3_bucket.%s.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [
        aws_s3_bucket.%s.arn,
        "$${aws_s3_bucket.%s.arn}/*",
      ]
      Condition = {
        Bool = { "aws:SecureTransport" = "false" }
      }
    }]
  })
}`, bucketName, bucketName, bucketName, bucketName)

	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: r.FilePath,
		Action:         "Create HTTPS-only bucket policy (DenyInsecureTransport)",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchLambdaEnvEncryption(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no Lambda function match"}
	}
	r := matches[0].ResourceBlock

	// Generate KMS key and inject kms_key_arn into the Lambda's environment block
	kmsSnippet := `resource "aws_kms_key" "lambda_env" {
  description             = "KMS key for Lambda environment variable encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true
}`

	// Inject kms_key_arn into the environment block
	reEnv := regexp.MustCompile(`(environment\s*\{[^}]*)(\})`)
	newBody := reEnv.ReplaceAllString(r.Body, "${1}\n    kms_key_arn = aws_kms_key.lambda_env.arn\n  ${2}")

	// If regex didn't match, try simpler injection before closing brace of environment
	if newBody == r.Body {
		envIdx := strings.Index(r.Body, "environment")
		if envIdx >= 0 {
			closeBrace := strings.LastIndex(r.Body[r.Body[envIdx]:], "}") + envIdx
			if closeBrace > envIdx {
				before := r.Body[:closeBrace]
				after := r.Body[closeBrace:]
				newBody = before + "\n    kms_key_arn = aws_kms_key.lambda_env.arn\n  " + after
			}
		}
	}

	targetFile := r.File
	for _, f := range req.Files {
		if f.Path == r.FilePath {
			targetFile = f.Content
			break
		}
	}

	patchedContent := strings.TrimSpace(targetFile) + "\n\n" + kmsSnippet
	if newBody != r.Body {
		patchedContent = replaceResourceBlock(r.File, r, newBody)
		patchedContent = strings.TrimSpace(patchedContent) + "\n\n" + kmsSnippet
	}

	return PatchResponse{
		Status: "modify_existing", FilePath: r.FilePath,
		Action:         "Add KMS key for Lambda env vars and inject kms_key_arn",
		SuggestedHCL:   newBody,
		PatchedContent: patchedContent,
		Matches:        matches,
	}
}

func patchVpcFlowLogs(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if req.VpcID == "" && len(matches) == 0 {
		return PatchResponse{Status: "error", Message: "vpc_id required"}
	}
	vpcRes := matches[0].ResourceBlock
	vpcName := vpcRes.Name

	_ = req.VpcID

	// Generate flow log + CloudWatch log group
	snippet := fmt.Sprintf(`resource "aws_cloudwatch_log_group" "vpc_flow_logs" {
  name              = "/aws/vpc/flow-logs"
  retention_in_days = 30
}

resource "aws_flow_log" "%s" {
  vpc_id               = aws_vpc.%s.id
  traffic_type         = "ALL"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.vpc_flow_logs.arn

  # Note: An IAM role for flow log delivery is required.
  # Add the following if not already defined:
  #
  # resource "aws_iam_role" "flow_logs" {
  #   name = "vpc-flow-logs-role"
  #   assume_role_policy = jsonencode({
  #     Version = "2012-10-17"
  #     Statement = [{
  #       Effect = "Allow"
  #       Principal = { Service = "vpc-flow-logs.amazonaws.com" }
  #       Action = "sts:AssumeRole"
  #     }]
  #   })
  # }
}
`, vpcName, vpcName)

	targetFile := vpcRes.File
	for _, f := range req.Files {
		if f.Path == vpcRes.FilePath {
			targetFile = f.Content
			break
		}
	}
	return PatchResponse{
		Status: "create_new", FilePath: vpcRes.FilePath,
		Action:         "Create aws_flow_log with CloudWatch log group (IAM role required — see comment)",
		SuggestedHCL:   snippet,
		PatchedContent: strings.TrimSpace(targetFile) + "\n\n" + snippet,
		Matches:        matches,
	}
}

func patchKmsWildcard(req PatchRequest, matches []ResourceMatch) PatchResponse {
	if len(matches) == 0 {
		return PatchResponse{Status: "not_found", Message: "no KMS key with wildcard policy found"}
	}

	// KMS key policy wildcard remediation is inherently context-dependent.
	// We can detect wildcards but cannot safely determine which principal to use.
	return PatchResponse{
		Status:  "repo_context_required",
		CheckID: req.CheckID,
		Message: "KMS key policy contains a wildcard principal. Automatic replacement requires knowing the intended principal — review manually and scope to specific IAM roles or accounts.",
		Matches: matches,
	}
}

// ── Helpers ─────────────────────────────────────────────────────────────────

func extractBraceBlock(text string, openIdx int) string {
	depth := 0
	for i := openIdx; i < len(text); i++ {
		switch text[i] {
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return text[openIdx : i+1]
			}
		}
	}
	return text[openIdx:]
}

func validateSyntax(files []TfFile) error {
	for _, f := range files {
		_, diags := parseConfig(f)
		if diags.HasErrors() {
			return fmt.Errorf("%s: %s", f.Path, diags.Error())
		}
	}
	return nil
}
