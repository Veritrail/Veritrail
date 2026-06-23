terraform {
  source = "../../../modules/s3-public"
}

inputs = {
  bucket_name = "cclab-public-artifacts"
}
