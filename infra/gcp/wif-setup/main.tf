# Customer GCP Workload Identity Federation setup for Veritrail
#
# Run once in the customer's GCP project. Veritrail exchanges short-lived OIDC
# tokens for federated access — no long-lived service account JSON keys.

variable "project_id" {
  type        = string
  description = "GCP project ID to scan"
}

variable "project_number" {
  type        = string
  description = "GCP project number (gcloud projects describe PROJECT_ID --format=value(projectNumber))"
}

variable "veritrail_issuer_uri" {
  type        = string
  description = "Veritrail OIDC issuer (from Integrations → Google Cloud setup)"
}

variable "veritrail_token_audience" {
  type        = string
  description = "OIDC audience configured in Veritrail (GCP_WIF_VERITRAIL_AUDIENCE)"
  default     = "veritrail-gcp"
}

variable "wif_subject" {
  type        = string
  description = "Per-connection subject from Veritrail (bind this principal to the scanner SA)"
}

variable "pool_id" {
  type    = string
  default = "veritrail"
}

variable "provider_id" {
  type    = string
  default = "veritrail-oidc"
}

variable "scanner_sa_id" {
  type    = string
  default = "veritrail-scanner"
}

resource "google_iam_workload_identity_pool" "veritrail" {
  project                   = var.project_id
  workload_identity_pool_id = var.pool_id
  display_name              = "Veritrail"
  description               = "Federated access for Veritrail posture scans"
}

resource "google_iam_workload_identity_pool_provider" "veritrail_oidc" {
  project                            = var.project_id
  workload_identity_pool_id          = google_iam_workload_identity_pool.veritrail.workload_identity_pool_id
  workload_identity_pool_provider_id = var.provider_id
  display_name                       = "Veritrail OIDC"
  attribute_mapping = {
    "google.subject" = "assertion.sub"
  }
  oidc {
    issuer_uri = var.veritrail_issuer_uri
    allowed_audiences = [var.veritrail_token_audience]
  }
}

resource "google_service_account" "scanner" {
  project      = var.project_id
  account_id   = var.scanner_sa_id
  display_name = "Veritrail scanner (read-only)"
}

resource "google_project_iam_member" "scanner_viewer" {
  project = var.project_id
  role    = "roles/viewer"
  member  = "serviceAccount:${google_service_account.scanner.email}"
}

resource "google_project_iam_member" "scanner_logging_viewer" {
  project = var.project_id
  role    = "roles/logging.viewer"
  member  = "serviceAccount:${google_service_account.scanner.email}"
}

resource "google_service_account_iam_member" "wif_user" {
  service_account_id = google_service_account.scanner.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principal://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${var.pool_id}/subject/${var.wif_subject}"
}

output "service_account_email" {
  value = google_service_account.scanner.email
}

output "wif_audience" {
  value = "//iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${var.pool_id}/providers/${var.provider_id}"
}

output "principal_member" {
  value = "principal://iam.googleapis.com/projects/${var.project_number}/locations/global/workloadIdentityPools/${var.pool_id}/subject/${var.wif_subject}"
}
