"""HTML escaping for transactional email bodies."""
from app.core.html_email import html_email


def test_html_email_escapes_markup():
    assert html_email('<script>alert("x")</script>') == (
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    )


def test_digest_html_escapes_finding_title():
    from app.services.digest import _html

    body = _html(
        org_name='Acme "<img>"',
        account_label="prod",
        open_findings=[
            {
                "title": '<b onclick="evil">Root MFA</b>',
                "resource_arn": 'arn:aws:iam::1:root"><script>',
                "severity": "critical",
                "risk_score": 99,
            }
        ],
        new_this_week=[],
        resolved_this_week=0,
    )
    assert "<script>" not in body
    assert "&lt;b onclick=&quot;evil&quot;&gt;" in body
    assert "&quot;&gt;&lt;script&gt;" in body
