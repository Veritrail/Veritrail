from app.core.sensitive_display import mask_access_key_id, mask_sensitive_text


def test_mask_access_key_id_shows_prefix_and_suffix_only():
    assert mask_access_key_id("AKIA5Y4LZ2QPWNG7REFM") == "AKIA••••REFM"


def test_mask_sensitive_text_in_sentence():
    raw = "Access key `AKIA5Y4LZ2QPWNG7REFM` for `cclabadmin` is 1534 days old"
    assert mask_sensitive_text(raw) == "Access key `AKIA••••REFM` for `cclabadmin` is 1534 days old"
