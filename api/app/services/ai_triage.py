"""AI-assisted finding triage — calls an LLM to classify findings.

Plug any OpenAI-compatible endpoint; the default is gpt-4o-mini over the
configured AI_TRIAGE_API_URL.  If AI_TRIAGE_ENABLED is False all callers
short-circuit immediately.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import structlog

from app.core.config import get_settings

log = structlog.get_logger()


@dataclass
class TriageResult:
    confidence_score: float
    rationale: str
    suggested_action: str  # snooze | resolve | review | ignore

    _VALID_ACTIONS = frozenset({"snooze", "resolve", "review", "ignore"})

    def __post_init__(self) -> None:
        if not (0.0 <= self.confidence_score <= 1.0):
            raise ValueError(f"confidence_score must be 0-1, got {self.confidence_score}")
        if self.suggested_action not in self._VALID_ACTIONS:
            raise ValueError(
                f"suggested_action must be one of {sorted(self._VALID_ACTIONS)}, got {self.suggested_action!r}"
            )


TRIAGE_SYSTEM_PROMPT = """You are a cloud security compliance triage assistant.  You will receive
metadata about a single AWS compliance finding.  Your job is to assess how
likely this finding is a *true positive* (real security or compliance issue
that should be addressed) versus a *false positive / noise*.

Respond ONLY with a JSON object containing exactly three fields:

- "confidence_score": a float between 0.0 and 1.0 where higher means more
  confident this is a TRUE POSITIVE (real risk).  0.0 = certain false
  positive, 1.0 = certain true positive.

- "rationale": a concise Plain-English explanation (2-5 sentences) of why
  you assigned that score.  Mention specific evidence fields, resource
  configuration details, or historical patterns that influenced your
  decision.

- "suggested_action": one of "snooze", "resolve", "review", or "ignore".
  Choose based on the severity and your confidence:
    - "snooze": low-risk, likely benign — postpone for now
    - "resolve": clear/actionable fix needed
    - "review": ambiguous — needs human judgement
    - "ignore": almost certainly a false positive, safe to dismiss

Guidelines:

* Findings for resources that appear to be test/dev/sandbox are more likely
  false positives.
* Root-account findings and public-exposure findings are almost always true
  positives.
* Service-linked roles and AWS-managed resources are often false positives.
* If a resource has been unchanged for a long time without incident, it may
  be intentional.
* Weigh the severity field — critical/high findings deserve extra scrutiny.

Respond with pure JSON only, no markdown fences, no commentary."""


def _build_triage_prompt(finding_context: dict[str, Any]) -> str:
    """Render the finding context into the user message for the LLM."""
    lines = ["Analyze this compliance finding:", json.dumps(finding_context, default=str, indent=2)]
    return "\n".join(lines)


def _parse_llm_response(raw: str) -> TriageResult:
    """Parse the LLM's JSON response into a TriageResult.

    Handles common LLM formatting quirks: markdown code fences, trailing
    commas, and extra commentary before/after the JSON blob.
    """
    # strip markdown fences
    text = raw.strip()
    if text.startswith("```"):
        # find the closing fence
        end = text.find("```", 3)
        if end != -1:
            text = text[3:end].strip()
        else:
            text = text[3:].strip()
        # remove optional language tag
        if text.startswith("json"):
            text = text[4:].strip()

    # try to extract the first JSON object
    match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
    if match:
        text = match.group(0)

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise ValueError(f"LLM returned unparseable JSON: {raw[:500]}")

    return TriageResult(
        confidence_score=float(data["confidence_score"]),
        rationale=str(data["rationale"]),
        suggested_action=str(data["suggested_action"]),
    )


def call_llm_for_triage(finding_context: dict[str, Any]) -> TriageResult | None:
    """Send the finding context to the LLM and return a parsed TriageResult.

    Returns None when AI_TRIAGE_ENABLED=False or the LLM call fails (so
    callers can gracefully skip triage without blocking the scan).
    """
    settings = get_settings()
    if not settings.AI_TRIAGE_ENABLED:
        return None

    if not settings.AI_TRIAGE_API_URL:
        log.warning("ai_triage.no_api_url")
        return None

    import httpx

    try:
        resp = httpx.post(
            f"{settings.AI_TRIAGE_API_URL.rstrip('/')}/v1/chat/completions",
            json={
                "model": settings.AI_TRIAGE_MODEL,
                "messages": [
                    {"role": "system", "content": TRIAGE_SYSTEM_PROMPT},
                    {"role": "user", "content": _build_triage_prompt(finding_context)},
                ],
                "temperature": 0.1,
                "max_tokens": 1024,
            },
            headers={
                "Authorization": f"Bearer {settings.AI_TRIAGE_API_KEY}",
                "Content-Type": "application/json",
            },
            timeout=30.0,
        )
        resp.raise_for_status()
        body = resp.json()
    except httpx.HTTPError as exc:
        log.warning("ai_triage.http_error", error=str(exc)[:200])
        return None
    except Exception:
        log.exception("ai_triage.unexpected_error")
        return None

    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        log.warning("ai_triage.bad_response_shape", body=str(body)[:400])
        return None

    try:
        result = _parse_llm_response(content)
        log.info(
            "ai_triage.success",
            confidence=result.confidence_score,
            action=result.suggested_action,
        )
        return result
    except Exception:
        log.exception("ai_triage.parse_failed", raw=str(content)[:400])
        return None
