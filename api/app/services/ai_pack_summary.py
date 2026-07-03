"""AI-generated narrative summary for evidence pack exports (Phase 9)."""
from __future__ import annotations

import json
from typing import Any

import structlog

from app.core.config import get_settings
from app.services.ai_triage import call_llm_for_triage, llm_config_error

log = structlog.get_logger()

PACK_SUMMARY_SYSTEM = """You are a SOC 2 audit readiness assistant. Summarize an evidence pack for an external auditor.
Respond ONLY with JSON:
{
  "executive_summary": "2-4 sentences on overall posture",
  "priority_controls": ["control_id — short reason", ...],
  "strengths": ["bullet", ...],
  "gaps": ["bullet", ...],
  "recommended_actions": ["bullet", ...]
}
Be factual. Use control IDs from the input. No markdown fences."""


def _heuristic_pack_summary(control_results: list[dict[str, Any]], *, framework: str) -> dict[str, Any]:
    failing = [c for c in control_results if c.get("status") == "fail"]
    at_risk = [c for c in control_results if c.get("status") == "at_risk"]
    passing = [c for c in control_results if c.get("status") == "pass"]
    no_data = [c for c in control_results if c.get("status") == "no_data"]

    priority = []
    for c in sorted(failing, key=lambda x: -int(x.get("finding_count") or 0))[:5]:
        priority.append(f"{c['control_id']} — {c.get('finding_count', 0)} open finding(s)")
    for c in at_risk[:3]:
        priority.append(f"{c['control_id']} — at-risk supporting signals")

    total = len(control_results)
    pass_rate = round(100 * len(passing) / total, 1) if total else 0.0
    summary = (
        f"{framework.upper()} evidence pack covers {total} controls. "
        f"{len(passing)} pass ({pass_rate}%), {len(failing)} fail, {len(at_risk)} at risk, "
        f"{len(no_data)} unevaluated."
    )
    if failing:
        summary += f" Highest priority: {failing[0]['control_id']} ({failing[0].get('title', '')})."

    gaps = [f"{c['control_id']}: {c.get('status_note') or c.get('title')}" for c in failing[:6]]
    strengths = [f"{c['control_id']}: passing with no open benchmark findings" for c in passing[:4]]

    return {
        "mode": "heuristic",
        "executive_summary": summary,
        "priority_controls": priority,
        "strengths": strengths,
        "gaps": gaps,
        "recommended_actions": [
            "Remediate failing benchmark controls before audit fieldwork.",
            "Upload accepted external evidence for HR, vendor-risk, and endpoint categories where automated scans cannot attest.",
            "Review at-risk controls for supporting-signal hygiene items.",
        ],
        "stats": {
            "total_controls": total,
            "pass": len(passing),
            "fail": len(failing),
            "at_risk": len(at_risk),
            "no_data": len(no_data),
        },
    }


def _call_llm_pack_summary(context: dict[str, Any]) -> dict[str, Any] | None:
    settings = get_settings()
    if not settings.AI_TRIAGE_ENABLED or llm_config_error():
        return None
    import httpx

    try:
        resp = httpx.post(
            f"{settings.AI_TRIAGE_API_URL.rstrip('/')}/v1/chat/completions",
            json={
                "model": settings.AI_TRIAGE_MODEL,
                "messages": [
                    {"role": "system", "content": PACK_SUMMARY_SYSTEM},
                    {"role": "user", "content": json.dumps(context, default=str)},
                ],
                "temperature": 0.2,
                "max_tokens": 1500,
            },
            headers={
                "Authorization": f"Bearer {settings.AI_TRIAGE_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=45.0,
        )
        resp.raise_for_status()
        content = resp.json()["choices"][0]["message"]["content"]
        text = content.strip()
        if text.startswith("```"):
            end = text.find("```", 3)
            text = text[3:end if end != -1 else None].strip()
            if text.startswith("json"):
                text = text[4:].strip()
        data = json.loads(text)
        data["mode"] = "llm"
        return data
    except Exception:
        log.exception("ai_pack_summary.llm_failed")
        return None


def build_ai_pack_summary(
    control_results: list[dict[str, Any]],
    *,
    framework: str,
    period_days: int,
    account_label: str,
) -> dict[str, Any]:
    """Build pack-level narrative; LLM when configured, else deterministic heuristic."""
    compact = [
        {
            "control_id": c.get("control_id"),
            "title": c.get("title"),
            "status": c.get("status"),
            "finding_count": c.get("finding_count"),
            "status_note": c.get("status_note"),
        }
        for c in control_results
    ]
    context = {
        "framework": framework,
        "period_days": period_days,
        "account_label": account_label,
        "controls": compact,
    }
    llm = _call_llm_pack_summary(context)
    if llm:
        llm.setdefault("stats", _heuristic_pack_summary(control_results, framework=framework).get("stats", {}))
        return llm
    return _heuristic_pack_summary(control_results, framework=framework)
