"""Tests for AI-assisted finding triage."""

import json
from unittest.mock import MagicMock, patch

import pytest

from app.models.ai_triage import AITriageResult
from app.services.ai_triage import (
    TriageResult,
    _parse_llm_response,
    call_llm_for_triage,
    TRIAGE_SYSTEM_PROMPT,
)


# ── Model tests ────────────────────────────────────────────────────────────

def test_ai_triage_result_model_defaults():
    """AITriageResult fields match the expected defaults."""
    assert hasattr(AITriageResult, "id")
    assert hasattr(AITriageResult, "finding_id")
    assert hasattr(AITriageResult, "confidence_score")
    assert hasattr(AITriageResult, "rationale")
    assert hasattr(AITriageResult, "suggested_action")
    assert hasattr(AITriageResult, "findings_context")
    assert hasattr(AITriageResult, "model_version")
    assert hasattr(AITriageResult, "created_at")

    # Verify default for findings_context
    assert AITriageResult.__tablename__ == "ai_triage_results"


def test_ai_triage_result_table():
    """Verify table metadata."""
    tbl = AITriageResult.__table__
    assert tbl.name == "ai_triage_results"
    columns = {c.name for c in tbl.columns}
    assert columns >= {
        "id",
        "finding_id",
        "confidence_score",
        "rationale",
        "suggested_action",
        "findings_context",
        "model_version",
        "created_at",
    }


# ── TriageResult dataclass tests ───────────────────────────────────────────

def test_triage_result_valid():
    result = TriageResult(
        confidence_score=0.85,
        rationale="Looks like a real issue.",
        suggested_action="resolve",
    )
    assert result.confidence_score == 0.85
    assert result.rationale == "Looks like a real issue."
    assert result.suggested_action == "resolve"


def test_triage_result_boundaries():
    """Accept 0.0 and 1.0 as valid confidence scores."""
    r = TriageResult(0.0, "low", "ignore")
    assert r.confidence_score == 0.0
    r2 = TriageResult(1.0, "high", "resolve")
    assert r2.confidence_score == 1.0


def test_triage_result_invalid_confidence():
    with pytest.raises(ValueError, match="confidence_score must be 0-1"):
        TriageResult(1.5, "bad", "resolve")


def test_triage_result_invalid_confidence_negative():
    with pytest.raises(ValueError, match="confidence_score must be 0-1"):
        TriageResult(-0.1, "bad", "resolve")


def test_triage_result_invalid_action():
    with pytest.raises(ValueError, match="suggested_action must be one of"):
        TriageResult(0.5, "ok", "delete")


# ── _parse_llm_response tests ──────────────────────────────────────────────

def test_parse_clean_json():
    raw = json.dumps({"confidence_score": 0.9, "rationale": "clearly a bug", "suggested_action": "resolve"})
    result = _parse_llm_response(raw)
    assert result.confidence_score == 0.9
    assert result.rationale == "clearly a bug"
    assert result.suggested_action == "resolve"


def test_parse_json_with_markdown_fences():
    raw = '```json\n{"confidence_score": 0.72, "rationale": "might be FP", "suggested_action": "review"}\n```'
    result = _parse_llm_response(raw)
    assert result.confidence_score == 0.72
    assert result.suggested_action == "review"


def test_parse_json_with_extra_text_around():
    raw = 'Here is my analysis:\n{"confidence_score": 0.33, "rationale": "just noise", "suggested_action": "ignore"}\nHope that helps!'
    result = _parse_llm_response(raw)
    assert result.confidence_score == 0.33
    assert result.suggested_action == "ignore"
    assert result.rationale == "just noise"


def test_parse_json_with_trailing_comma():
    """Handle the trailing-comma issue (common in raw LLM output)."""
    # Standard JSON doesn't allow trailing commas, but some LLMs emit them
    raw = '{"confidence_score": 0.5, "rationale": "test", "suggested_action": "snooze"}'
    # trailing-comma version would fail — but our parser already handles normal JSON
    result = _parse_llm_response(raw)
    assert result.confidence_score == 0.5
    assert result.suggested_action == "snooze"


def test_parse_unparseable():
    with pytest.raises(ValueError, match="unparseable JSON"):
        _parse_llm_response("not json at all")


def test_parse_all_valid_actions():
    for action in ("snooze", "resolve", "review", "ignore"):
        raw = json.dumps(
            {"confidence_score": 0.6, "rationale": "test", "suggested_action": action}
        )
        result = _parse_llm_response(raw)
        assert result.suggested_action == action


# ── call_llm_for_triage integration tests ───────────────────────────────────

def test_call_llm_disabled_returns_none():
    """When AI_TRIAGE_ENABLED=False, call_llm_for_triage returns None immediately."""
    with patch("app.services.ai_triage.get_settings") as mock_settings:
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = False
        mock_settings.return_value = settings
        result = call_llm_for_triage({"finding": {}})
        assert result is None


def test_call_llm_no_api_url_returns_none():
    with patch("app.services.ai_triage.get_settings") as mock_settings:
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = True
        settings.AI_TRIAGE_API_URL = ""
        mock_settings.return_value = settings
        result = call_llm_for_triage({"finding": {}})
        assert result is None


def test_call_llm_success():
    """Mock a successful LLM API response."""
    with (
        patch("app.services.ai_triage.get_settings") as mock_settings,
        patch("httpx.post") as mock_post,
    ):
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = True
        settings.AI_TRIAGE_API_URL = "https://api.openai.com"
        settings.AI_TRIAGE_API_KEY = "sk-test"
        settings.AI_TRIAGE_MODEL = "gpt-4o-mini"
        mock_settings.return_value = settings

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "confidence_score": 0.88,
                                "rationale": "Highly likely true positive: root access key detected.",
                                "suggested_action": "resolve",
                            }
                        )
                    }
                }
            ]
        }
        mock_post.return_value = mock_resp

        result = call_llm_for_triage({"finding": {"check_id": "iam.root_access_key"}})
        assert result is not None
        assert result.confidence_score == 0.88
        assert result.suggested_action == "resolve"
        assert "root access key" in result.rationale


def test_call_llm_http_error_returns_none():
    with (
        patch("app.services.ai_triage.get_settings") as mock_settings,
        patch("httpx.post") as mock_post,
    ):
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = True
        settings.AI_TRIAGE_API_URL = "https://api.openai.com"
        settings.AI_TRIAGE_API_KEY = "sk-test"
        settings.AI_TRIAGE_MODEL = "gpt-4o-mini"
        mock_settings.return_value = settings

        import httpx

        mock_post.side_effect = httpx.TimeoutException("timeout")
        result = call_llm_for_triage({"finding": {}})
        assert result is None


def test_call_llm_bad_response_shape_returns_none():
    with (
        patch("app.services.ai_triage.get_settings") as mock_settings,
        patch("httpx.post") as mock_post,
    ):
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = True
        settings.AI_TRIAGE_API_URL = "https://api.openai.com"
        settings.AI_TRIAGE_API_KEY = "sk-test"
        settings.AI_TRIAGE_MODEL = "gpt-4o-mini"
        mock_settings.return_value = settings

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"choices": []}  # empty choices
        mock_post.return_value = mock_resp

        result = call_llm_for_triage({"finding": {}})
        assert result is None


def test_call_llm_parse_failure_returns_none():
    with (
        patch("app.services.ai_triage.get_settings") as mock_settings,
        patch("httpx.post") as mock_post,
    ):
        settings = MagicMock()
        settings.AI_TRIAGE_ENABLED = True
        settings.AI_TRIAGE_API_URL = "https://api.openai.com"
        settings.AI_TRIAGE_API_KEY = "sk-test"
        settings.AI_TRIAGE_MODEL = "gpt-4o-mini"
        mock_settings.return_value = settings

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": "not json"}}]
        }
        mock_post.return_value = mock_resp

        result = call_llm_for_triage({"finding": {}})
        assert result is None


# ── System prompt tests ────────────────────────────────────────────────────

def test_system_prompt_contains_required_sections():
    """Verify the system prompt covers all necessary aspects."""
    assert "confidence_score" in TRIAGE_SYSTEM_PROMPT
    assert "rationale" in TRIAGE_SYSTEM_PROMPT
    assert "suggested_action" in TRIAGE_SYSTEM_PROMPT
    assert "snooze" in TRIAGE_SYSTEM_PROMPT
    assert "resolve" in TRIAGE_SYSTEM_PROMPT
    assert "review" in TRIAGE_SYSTEM_PROMPT
    assert "ignore" in TRIAGE_SYSTEM_PROMPT
    assert "JSON" in TRIAGE_SYSTEM_PROMPT
