package main

import (
	"fmt"
	"regexp"
	"strings"
)

type ScanRequest struct {
	CheckID    string   `json:"check_id"`
	BucketName string   `json:"bucket_name,omitempty"`
	KeyID      string   `json:"key_id,omitempty"`
	GroupID    string   `json:"group_id,omitempty"`
	GroupName  string   `json:"group_name,omitempty"`
	// New fields for expanded check types
	InstanceID   string   `json:"instance_id,omitempty"`   // RDS
	TopicName    string   `json:"topic_name,omitempty"`    // SNS
	QueueName    string   `json:"queue_name,omitempty"`    // SQS
	RepoName     string   `json:"repo_name,omitempty"`     // ECR
	VpcID        string   `json:"vpc_id,omitempty"`        // VPC Flow Logs
	FunctionName string   `json:"function_name,omitempty"` // Lambda
	LbName       string   `json:"lb_name,omitempty"`       // ELB
	Files        []TfFile `json:"files"`
}

type ScanResponse struct {
	Status       string          `json:"status"`
	Message      string          `json:"message,omitempty"`
	CheckID      string          `json:"check_id,omitempty"`
	FilesScanned int             `json:"files_scanned"`
	Matches      []ResourceMatch `json:"matches,omitempty"`
	CanPatch     bool            `json:"can_patch"`
}

// patchableChecks is the single source of truth for which checks hclpatch can handle.
var patchableChecks = map[string]bool{
	"s3.bucket.public_access_not_blocked":     true,
	"kms.key.no_rotation":                     true,
	"rds.instance.no_storage_encryption":      true,
	"rds.instance.publicly_accessible":        true,
	"sns.topic.no_encryption":                 true,
	"sqs.queue.no_encryption":                 true,
	"guardduty.detector.disabled":             true,
	"ec2.ebs.encryption_not_default":          true,
	"iam.account.password_policy_weak":        true,
	"ecr.repository.image_scan_disabled":      true,
	"s3.bucket.default_encryption_disabled":   true,
	"cloudtrail.trail.not_enabled":            true,
	"elb.access_logs_disabled":                true,
	"s3.bucket.no_https_policy":               true,
	"lambda.function.env_vars_unencrypted":    true,
	"ec2.vpc.no_flow_logs":                    true,
	"kms.key.policy_wildcard_principal":       true,
}

func scanRequest(req ScanRequest) ScanResponse {
	if len(req.Files) == 0 {
		return ScanResponse{Status: "error", Message: "no .tf/.hcl files provided"}
	}
	resources := parseAllResources(req.Files)
	var matches []ResourceMatch

	switch req.CheckID {
	case "s3.bucket.public_access_not_blocked":
		matches = scanS3Bucket(resources, req.BucketName)
	case "kms.key.no_rotation":
		matches = scanKmsKey(resources, req.KeyID)
	case "ec2.security_group.unrestricted_ssh", "ec2.security_group.unrestricted_rdp":
		matches = scanSecurityGroup(resources, req.GroupID, req.GroupName)
	// Phase 1A — easy attribute toggles
	case "rds.instance.no_storage_encryption":
		matches = scanRdsUnencrypted(resources, req.InstanceID)
	case "rds.instance.publicly_accessible":
		matches = scanRdsPublic(resources, req.InstanceID)
	case "sns.topic.no_encryption":
		matches = scanSnsUnencrypted(resources, req.TopicName)
	case "sqs.queue.no_encryption":
		matches = scanSqsUnencrypted(resources, req.QueueName)
	case "guardduty.detector.disabled":
		matches = scanGuardDuty(resources)
	case "ec2.ebs.encryption_not_default":
		matches = scanEbsDefaultEncryption(resources)
	case "iam.account.password_policy_weak":
		matches = scanPasswordPolicy(resources)
	case "ecr.repository.image_scan_disabled":
		matches = scanEcrScanning(resources, req.RepoName)
	// Phase 1B — block insertions
	case "s3.bucket.default_encryption_disabled":
		matches = scanS3DefaultEncryption(resources, req.BucketName)
	case "cloudtrail.trail.not_enabled":
		matches = scanCloudTrail(resources)
	case "elb.access_logs_disabled":
		matches = scanElbAccessLogs(resources, req.LbName)
	// Phase 2 — complex
	case "s3.bucket.no_https_policy":
		matches = scanS3HttpsPolicy(resources, req.BucketName)
	case "lambda.function.env_vars_unencrypted":
		matches = scanLambdaEnvEncryption(resources, req.FunctionName)
	case "ec2.vpc.no_flow_logs":
		matches = scanVpcFlowLogs(resources, req.VpcID)
	case "kms.key.policy_wildcard_principal":
		matches = scanKmsWildcard(resources, req.KeyID)
	default:
		return ScanResponse{
			Status:       "unsupported",
			CheckID:      req.CheckID,
			FilesScanned: len(req.Files),
			Message:      "repo scan not implemented for this check",
		}
	}

	if len(matches) == 0 {
		return ScanResponse{
			Status:       "not_found",
			CheckID:      req.CheckID,
			FilesScanned: len(req.Files),
			Message:      "no matching Terraform resource in scanned files",
			CanPatch:     false,
		}
	}
	canPatch := patchableChecks[req.CheckID]
	return ScanResponse{
		Status:       "matched",
		CheckID:      req.CheckID,
		FilesScanned: len(req.Files),
		Matches:      matches,
		CanPatch:     canPatch,
	}
}

// ── Existing scan functions ──────────────────────────────────────────────────

var reMinLen = regexp.MustCompile(`minimum_password_length\s*=\s*("?(\d+)"?)`)

func scanS3Bucket(resources []ResourceBlock, bucketName string) []ResourceMatch {
	if bucketName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_s3_bucket" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["bucket"] == bucketName || r.Name == bucketName {
			out = append(out, ResourceMatch{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("bucket attribute %q or resource name", bucketName),
			})
		}
	}
	return out
}

func scanKmsKey(resources []ResourceBlock, keyID string) []ResourceMatch {
	if keyID == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_kms_key" && r.Type != "aws_kms_replica_key" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if strings.Contains(r.Body, keyID) || attrs["description"] == keyID || r.Name == keyID {
			out = append(out, ResourceMatch{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("KMS key reference %q", keyID),
			})
		}
	}
	return out
}

func scanSecurityGroup(resources []ResourceBlock, groupID, groupName string) []ResourceMatch {
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_security_group" && r.Type != "aws_default_security_group" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		name := attrs["name"]
		if groupName != "" && (name == groupName || r.Name == groupName) {
			out = append(out, ResourceMatch{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("security group name %q", groupName),
			})
			continue
		}
		if groupID != "" && strings.Contains(r.Body, groupID) {
			out = append(out, ResourceMatch{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("references group id %q", groupID),
			})
		}
	}
	return out
}

// ── Phase 1A: Easy attribute toggles ─────────────────────────────────────────

func scanRdsUnencrypted(resources []ResourceBlock, instanceID string) []ResourceMatch {
	if instanceID == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_db_instance" && r.Type != "aws_rds_cluster" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["identifier"] != instanceID && r.Name != instanceID {
			continue
		}
		// Only match if not already encrypted
		if attrs["storage_encrypted"] == "true" {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("RDS instance %q", instanceID),
		})
	}
	return out
}

func scanRdsPublic(resources []ResourceBlock, instanceID string) []ResourceMatch {
	if instanceID == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_db_instance" && r.Type != "aws_rds_cluster" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["identifier"] != instanceID && r.Name != instanceID {
			continue
		}
		// Only match if publicly_accessible = true is present
		if !strings.Contains(r.Body, "publicly_accessible") || attrs["publicly_accessible"] != "true" {
			// Check for non-string "publicly_accessible = true"
			if !strings.Contains(r.Body, "publicly_accessible = true") {
				continue
			}
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("RDS instance %q is publicly accessible", instanceID),
		})
	}
	return out
}

func scanSnsUnencrypted(resources []ResourceBlock, topicName string) []ResourceMatch {
	if topicName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_sns_topic" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["name"] != topicName && r.Name != topicName {
			continue
		}
		// Skip if already encrypted with a KMS key
		if _, ok := attrs["kms_master_key_id"]; ok {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("SNS topic %q lacks kms_master_key_id", topicName),
		})
	}
	return out
}

func scanSqsUnencrypted(resources []ResourceBlock, queueName string) []ResourceMatch {
	if queueName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_sqs_queue" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["name"] != queueName && r.Name != queueName {
			continue
		}
		// Skip if already encrypted
		if _, ok := attrs["kms_master_key_id"]; ok {
			continue
		}
		if attrs["sqs_managed_sse_enabled"] == "true" {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("SQS queue %q lacks encryption", queueName),
		})
	}
	return out
}

func scanGuardDuty(resources []ResourceBlock) []ResourceMatch {
	for _, r := range resources {
		if r.Type != "aws_guardduty_detector" {
			continue
		}
		// Found a detector — only match if enable = false
		if strings.Contains(r.Body, "enable = false") {
			return []ResourceMatch{{
				ResourceBlock: r,
				MatchReason:   "guardduty detector exists but enable = false",
			}}
		}
		// Already enabled — no match
		if strings.Contains(r.Body, "enable = true") || !strings.Contains(r.Body, "enable") {
			return nil
		}
		// Has an enable attribute but bogus value — still match for patching
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "guardduty detector found with unclear enable state",
		}}
	}
	// No detector found — match the first .tf file for create_new
	for _, r := range resources {
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "no guardduty detector found — create new",
		}}
	}
	return nil
}

func scanEbsDefaultEncryption(resources []ResourceBlock) []ResourceMatch {
	for _, r := range resources {
		if r.Type != "aws_ebs_encryption_by_default" {
			continue
		}
		// Found the singleton — only match if enabled = false
		attrs := attrsFromBody(r.Body)
		if attrs["enabled"] == "false" || strings.Contains(r.Body, "enabled = false") {
			return []ResourceMatch{{
				ResourceBlock: r,
				MatchReason:   "ebs encryption by default is disabled",
			}}
		}
		// Already enabled
		return nil
	}
	// No singleton found — create new
	for _, r := range resources {
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "no aws_ebs_encryption_by_default — create new",
		}}
	}
	return nil
}

func scanPasswordPolicy(resources []ResourceBlock) []ResourceMatch {
	for _, r := range resources {
		if r.Type != "aws_iam_account_password_policy" {
			continue
		}
		body := r.Body
		// Weak if min_length < 14 or any required flag is false
		weak := false
		// Check numeric min_length value using regex (handles both = 8 and = "8")
		if reMinLen.MatchString(body) {
			match := reMinLen.FindStringSubmatch(body)
			if len(match) >= 2 {
				numericVal := strings.Trim(match[1], "\"'")
				if numericVal == "8" || numericVal == "10" || numericVal == "12" {
					weak = true
				}
			}
		}
		if strings.Contains(body, "require_lowercase_characters = false") ||
			strings.Contains(body, "require_uppercase_characters = false") ||
			strings.Contains(body, "require_numbers = false") ||
			strings.Contains(body, "require_symbols = false") {
			weak = true
		}
		if strings.Contains(body, "password_reuse_prevention = 0") || strings.Contains(body, "password_reuse_prevention = 5") ||
			strings.Contains(body, "password_reuse_prevention = \"0\"") || strings.Contains(body, "password_reuse_prevention = \"5\"") {
			weak = true
		}
		if strings.Contains(body, "max_password_age = 0") || strings.Contains(body, "max_password_age = \"0\"") {
			weak = true
		}
		if weak {
			return []ResourceMatch{{
				ResourceBlock: r,
				MatchReason:   "password policy has weak settings",
			}}
		}
		// Already compliant — no match
		return nil
	}
	// No password policy — create new
	for _, r := range resources {
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "no aws_iam_account_password_policy — create new",
		}}
	}
	return nil
}

func scanEcrScanning(resources []ResourceBlock, repoName string) []ResourceMatch {
	if repoName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_ecr_repository" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["name"] != repoName && r.Name != repoName {
			continue
		}
		// Skip if already has scan_on_push = true
		if strings.Contains(r.Body, "scan_on_push = true") {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("ECR repository %q lacks scan_on_push", repoName),
		})
	}
	return out
}

// ── Phase 1B: Block insertions ──────────────────────────────────────────────

func scanS3DefaultEncryption(resources []ResourceBlock, bucketName string) []ResourceMatch {
	if bucketName == "" {
		return nil
	}
	// First find the S3 bucket
	var bucketRes *ResourceBlock
	for i, r := range resources {
		if r.Type != "aws_s3_bucket" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["bucket"] == bucketName || r.Name == bucketName {
			bucketRes = &resources[i]
			break
		}
	}
	if bucketRes == nil {
		return nil
	}
	// Check for existing SSE config
	for _, r := range resources {
		if r.Type != "aws_s3_bucket_server_side_encryption_configuration" {
			continue
		}
		// Check if this SSE config references the same bucket
		attrs := attrsFromBody(r.Body)
		if attrs["bucket"] == bucketName || attrs["bucket"] == bucketRes.Name ||
			strings.Contains(r.Body, bucketName) || strings.Contains(r.Body, "aws_s3_bucket."+bucketRes.Name) {
			// Check if it already has an encryption rule
			if strings.Contains(r.Body, "sse_algorithm") || strings.Contains(r.Body, "apply_server_side_encryption_by_default") {
				return nil // Already has encryption configured
			}
			return []ResourceMatch{{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("SSE config for bucket %q exists but no encryption rule", bucketName),
			}}
		}
	}
	// No SSE config — match the bucket for create_new
	return []ResourceMatch{{
		ResourceBlock: *bucketRes,
		MatchReason:   fmt.Sprintf("no SSE config for bucket %q — create new", bucketName),
	}}
}

func scanCloudTrail(resources []ResourceBlock) []ResourceMatch {
	for _, r := range resources {
		if r.Type != "aws_cloudtrail" {
			continue
		}
		// Found a CloudTrail — check if it's properly configured
		hasMultiRegion := strings.Contains(r.Body, "is_multi_region_trail = true")
		hasLogging := strings.Contains(r.Body, "enable_logging = true") || !strings.Contains(r.Body, "enable_logging = false")
		if hasMultiRegion && hasLogging {
			return nil // Already compliant
		}
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "existing cloudtrail needs configuration fixes",
		}}
	}
	// No CloudTrail — create new on first file
	for _, r := range resources {
		return []ResourceMatch{{
			ResourceBlock: r,
			MatchReason:   "no aws_cloudtrail found — create new",
		}}
	}
	return nil
}

func scanElbAccessLogs(resources []ResourceBlock, lbName string) []ResourceMatch {
	if lbName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_lb" && r.Type != "aws_elb" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["name"] != lbName && r.Name != lbName {
			continue
		}
		// Skip if access_logs block already exists
		if strings.Contains(r.Body, "access_logs") {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("load balancer %q lacks access_logs block", lbName),
		})
	}
	return out
}

// ── Phase 2: Complex / context-dependent ─────────────────────────────────────

func scanS3HttpsPolicy(resources []ResourceBlock, bucketName string) []ResourceMatch {
	if bucketName == "" {
		return nil
	}
	var bucketRes *ResourceBlock
	for i, r := range resources {
		if r.Type != "aws_s3_bucket" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["bucket"] == bucketName || r.Name == bucketName {
			bucketRes = &resources[i]
			break
		}
	}
	if bucketRes == nil {
		return nil
	}
	// Check for existing bucket policy that references this bucket
	for _, r := range resources {
		if r.Type != "aws_s3_bucket_policy" {
			continue
		}
		if strings.Contains(r.Body, bucketName) || strings.Contains(r.Body, "aws_s3_bucket."+bucketRes.Name) {
			// Existing policy found — return repo_context_required in patch phase
			return []ResourceMatch{{
				ResourceBlock: r,
				MatchReason:   fmt.Sprintf("existing bucket policy for %q — merge required", bucketName),
			}}
		}
	}
	// No existing policy — create new on the bucket file
	return []ResourceMatch{{
		ResourceBlock: *bucketRes,
		MatchReason:   fmt.Sprintf("no HTTPS policy for bucket %q — create new", bucketName),
	}}
}

func scanLambdaEnvEncryption(resources []ResourceBlock, functionName string) []ResourceMatch {
	if functionName == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_lambda_function" {
			continue
		}
		attrs := attrsFromBody(r.Body)
		if attrs["function_name"] != functionName && r.Name != functionName {
			continue
		}
		// Check if it has environment variables block
		if !strings.Contains(r.Body, "environment {") && !strings.Contains(r.Body, "environment{") {
			continue // No env vars — nothing to encrypt
		}
		// Check if kms_key_arn is already set in the environment block
		if strings.Contains(r.Body, "kms_key_arn") {
			continue
		}
		out = append(out, ResourceMatch{
			ResourceBlock: r,
			MatchReason:   fmt.Sprintf("lambda function %q has unencrypted env vars", functionName),
		})
	}
	return out
}

func scanVpcFlowLogs(resources []ResourceBlock, vpcID string) []ResourceMatch {
	if vpcID == "" {
		return nil
	}
	// Find the VPC resource
	var vpcRes *ResourceBlock
	for i, r := range resources {
		if r.Type != "aws_vpc" {
			continue
		}
		if strings.Contains(r.Body, vpcID) || r.Name == vpcID {
			vpcRes = &resources[i]
			break
		}
	}
	if vpcRes == nil {
		return nil
	}
	// Check if a flow log already exists for this VPC
	for _, r := range resources {
		if r.Type != "aws_flow_log" {
			continue
		}
		if strings.Contains(r.Body, vpcID) || strings.Contains(r.Body, "aws_vpc."+vpcRes.Name) {
			return nil // Already has flow log
		}
	}
	return []ResourceMatch{{
		ResourceBlock: *vpcRes,
		MatchReason:   fmt.Sprintf("no flow log for VPC %q — create new", vpcID),
	}}
}

func scanKmsWildcard(resources []ResourceBlock, keyID string) []ResourceMatch {
	if keyID == "" {
		return nil
	}
	var out []ResourceMatch
	for _, r := range resources {
		if r.Type != "aws_kms_key" && r.Type != "aws_kms_key_policy" {
			continue
		}
		if !strings.Contains(r.Body, keyID) && r.Name != keyID {
			continue
		}
		// Check for wildcard principal in policy
		hasWildcard := strings.Contains(r.Body, `"Principal": "*"`) ||
			strings.Contains(r.Body, `"Principal": {"AWS": "*"}`) ||
			strings.Contains(r.Body, `"AWS": "*"`)
		if hasWildcard {
			out = append(out, ResourceMatch{
				ResourceBlock: r,
				MatchReason:   "KMS key policy contains wildcard principal",
			})
		}
	}
	return out
}
