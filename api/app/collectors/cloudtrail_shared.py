"""Shared CloudTrail helpers used by multiple collectors.

Extracted from cloudtrail.py and cloudtrail_events.py to eliminate
duplicate _get_regions closures.
"""
from __future__ import annotations


def _get_regions(sess) -> list[str]:
    """EC2 DescribeRegions wrapper — returns all opted-in region names."""
    ec2 = sess.client("ec2", region_name="us-east-1")
    return [
        r["RegionName"]
        for r in ec2.describe_regions(
            Filters=[{"Name": "opt-in-status", "Values": ["opt-in-not-required", "opted-in"]}]
        )["Regions"]
    ]
