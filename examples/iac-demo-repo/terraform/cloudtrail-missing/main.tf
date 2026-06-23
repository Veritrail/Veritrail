terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

variable "aws_account_id" {
  type        = string
  description = "AWS account ID used for globally unique log bucket names."
}

resource "aws_s3_bucket" "application_logs" {
  bucket = "${var.aws_account_id}-application-logs"
}
