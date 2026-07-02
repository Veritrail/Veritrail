# Customer GCP service account setup for Veritrail (impersonation auth)
#
# Creates a read-only scanner SA and grants Veritrail's platform SA
# roles/iam.serviceAccountTokenCreator so Veritrail can impersonate it.

variable "project_id" {
  type        = string
  description = "GCP project ID to scan"
}

variable "veritrail_platform_sa_email" {
  type        = string
  description = "Veritrail platform service account email (from Integrations → Google Cloud setup)"
}

variable "scanner_sa_id" {
  type    = string
  default = "veritrail-scanner"
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

resource "google_project_iam_member" "scanner_osconfig_viewer" {
  project = var.project_id
  role    = "roles/osconfig.viewer"
  member  = "serviceAccount:${google_service_account.scanner.email}"
}

resource "google_project_iam_member" "scanner_security_center_viewer" {
  project = var.project_id
  role    = "roles/securitycenter.findingsViewer"
  member  = "serviceAccount:${google_service_account.scanner.email}"
}

resource "google_project_iam_member" "scanner_cloud_asset_viewer" {
  project = var.project_id
  role    = "roles/cloudasset.viewer"
  member  = "serviceAccount:${google_service_account.scanner.email}"
}

resource "google_service_account_iam_member" "veritrail_token_creator" {
  service_account_id = google_service_account.scanner.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${var.veritrail_platform_sa_email}"
}

output "service_account_email" {
  value = google_service_account.scanner.email
}
