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

resource "aws_ecr_repository" "api" {
  name = "veritrail-api"

  image_scanning_configuration {
    scan_on_push = false
  }
}
