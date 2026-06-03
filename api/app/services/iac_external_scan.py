"""Optional external IaC scanners (Checkov / tfsec) — augment, never replace, the native engine.

Off by default (per deepsearch v5 the native deterministic lint is always-on; external engines are
opt-in for teams that want broad coverage). If a binary is missing or errors, we degrade
gracefully — ``available=False`` + a reason — rather than failing the scan. Parsed output uses the
same ``IacFinding`` shape so the API surface is uniform across engines.

Read-only boundary: these tools statically analyze source text in a temp dir. They never touch AWS
and never modify the customer repo.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess  # noqa: S404 — used with fixed argv, no shell, no user-interpolated command
import tempfile

from app.services.iac_security_scan import (
    SEV_HIGH,
    SEV_LOW,
    SEV_MEDIUM,
    IacFinding,
    scan_terraform_files,
    sort_findings,
    summarize,
)

SUPPORTED_ENGINES = ("checkov", "tfsec")
_TIMEOUT_SECONDS = 120

# External tools use varied severity vocabularies; fold them into our three tiers.
_SEVERITY_MAP = {
    "CRITICAL": SEV_HIGH,
    "HIGH": SEV_HIGH,
    "ERROR": SEV_HIGH,
    "MEDIUM": SEV_MEDIUM,
    "WARNING": SEV_MEDIUM,
    "LOW": SEV_LOW,
    "INFO": SEV_LOW,
    "UNKNOWN": SEV_LOW,
}


def _map_severity(raw: str | None) -> str:
    return _SEVERITY_MAP.get((raw or "").upper(), SEV_MEDIUM)


def external_engine_available(engine: str) -> bool:
    """True when the engine binary is on PATH."""
    return shutil.which(engine) is not None


# ── Pure parsers (unit-testable without the binaries installed) ──────────────────────────────
def parse_checkov_json(data: dict) -> list[IacFinding]:
    """Map a ``checkov -o json`` document's failed_checks into IacFinding rows."""
    results = (data or {}).get("results") or {}
    failed = results.get("failed_checks") or []
    out: list[IacFinding] = []
    for c in failed:
        line_range = c.get("file_line_range") or [0]
        resource = c.get("resource") or ""
        rtype, _, rname = resource.partition(".")
        out.append(
            IacFinding(
                rule_id=f"checkov.{c.get('check_id', 'unknown')}",
                severity=_map_severity(c.get("severity")),
                title=c.get("check_name") or c.get("check_id") or "Checkov finding",
                detail=f"Checkov {c.get('check_id', '')}: {c.get('check_name', '')}".strip(": "),
                remediation=c.get("guideline") or "See Checkov documentation for this check.",
                resource_type=rtype,
                resource_name=rname,
                file_path=(c.get("file_path") or "").lstrip("/"),
                line=int(line_range[0]) if line_range else 0,
                refs=[c.get("guideline")] if c.get("guideline") else [],
                engine="checkov",
            )
        )
    return out


def parse_tfsec_json(data: dict) -> list[IacFinding]:
    """Map a ``tfsec --format json`` document's results into IacFinding rows."""
    out: list[IacFinding] = []
    for r in (data or {}).get("results") or []:
        loc = r.get("location") or {}
        resource = r.get("resource") or ""
        rtype, _, rname = resource.partition(".")
        out.append(
            IacFinding(
                rule_id=f"tfsec.{r.get('rule_id', 'unknown')}",
                severity=_map_severity(r.get("severity")),
                title=r.get("rule_description") or r.get("rule_id") or "tfsec finding",
                detail=r.get("description") or r.get("rule_description") or "",
                remediation=r.get("resolution") or "See tfsec documentation for this rule.",
                resource_type=rtype,
                resource_name=rname,
                file_path=(loc.get("filename") or "").lstrip("/"),
                line=int(loc.get("start_line") or 0),
                refs=[lk for lk in (r.get("links") or []) if isinstance(lk, str)],
                engine="tfsec",
            )
        )
    return out


# ── Thin subprocess adapters (not unit-tested; covered by integration when binaries exist) ───
def _write_files(files: list[dict[str, str]], root: str) -> None:
    for f in files:
        rel = (f.get("path") or "main.tf").lstrip("/")
        dest = os.path.join(root, rel)
        os.makedirs(os.path.dirname(dest) or root, exist_ok=True)
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(f.get("content") or "")


def _run(argv: list[str], cwd: str) -> subprocess.CompletedProcess:
    return subprocess.run(  # noqa: S603 — fixed argv (no shell), inputs are file paths only
        argv,
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=_TIMEOUT_SECONDS,
        check=False,
    )


def run_engine(engine: str, files: list[dict[str, str]]) -> dict:
    """Run one external engine over ``files`` in a temp dir. Always returns a result dict; never raises.

    Shape: ``{"engine", "available", "reason"?, "findings": [IacFinding...]}``.
    """
    if engine not in SUPPORTED_ENGINES:
        return {"engine": engine, "available": False, "reason": f"unsupported engine '{engine}'", "findings": []}
    if not external_engine_available(engine):
        return {
            "engine": engine,
            "available": False,
            "reason": f"{engine} binary not found on PATH (optional engine not installed)",
            "findings": [],
        }
    try:
        with tempfile.TemporaryDirectory(prefix=f"vigil-iac-{engine}-") as root:
            _write_files(files, root)
            if engine == "checkov":
                proc = _run(["checkov", "-d", ".", "-o", "json", "--compact", "--quiet"], root)
                data = json.loads(proc.stdout or "{}")
                # checkov emits a list when multiple frameworks run; normalize to the tf object.
                if isinstance(data, list):
                    data = next((d for d in data if (d.get("check_type") == "terraform")), data[0] if data else {})
                findings = parse_checkov_json(data)
            else:  # tfsec
                proc = _run(["tfsec", ".", "--format", "json", "--no-color"], root)
                data = json.loads(proc.stdout or "{}")
                findings = parse_tfsec_json(data)
        return {"engine": engine, "available": True, "findings": findings}
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        return {
            "engine": engine,
            "available": False,
            "reason": f"{engine} failed: {type(e).__name__}: {e}",
            "findings": [],
        }


def run_external(files: list[dict[str, str]], engines: list[str]) -> list[dict]:
    """Run each requested engine; return one result dict per engine (guarded, never raises)."""
    return [run_engine(e, files) for e in engines]


def combined_scan(files: list[dict[str, str]], engines: list[str] | None = None) -> dict:
    """Always-on native lint + optional external engines, merged into one severity-sorted summary.

    Returns ``summarize(...)`` plus an ``engines`` list describing each engine's availability.
    External findings are *added* — the native engine is never suppressed (deepsearch v5: native
    deterministic lint is the always-on baseline; Checkov/tfsec only broaden coverage).
    """
    findings: list[IacFinding] = list(scan_terraform_files(files))
    engine_status: list[dict] = [{"engine": "native", "available": True}]
    for result in run_external(files, engines or []):
        engine_status.append({k: v for k, v in result.items() if k != "findings"})
        findings.extend(result["findings"])
    sort_findings(findings)
    summary = summarize(findings)
    summary["engines"] = engine_status
    return summary
