import io
import json
from unittest.mock import Mock
from urllib.error import HTTPError

import pytest

from nfse_filler.browser import BrowserCommandError, ChromeSession


@pytest.mark.parametrize(
    ("code", "retryable"),
    [
        ("stale element reference", True),
        ("element click intercepted", True),
        ("element not interactable", True),
        ("invalid session id", False),
        ("no such window", False),
        ("javascript error", False),
        ("session not created", False),
    ],
)
def test_webdriver_error_keeps_code_without_exposing_page_values(tmp_path, code, retryable):
    session = ChromeSession(tmp_path)
    session.base_url = "http://127.0.0.1:12345"
    body = json.dumps(
        {
            "value": {
                "error": code,
                "message": "PRIVATE_GUEST_DOCUMENT",
                "stacktrace": "PRIVATE_TOKEN",
            }
        }
    ).encode()
    session.http.open = Mock(
        side_effect=HTTPError(session.base_url, 500, "Error", {}, io.BytesIO(body))
    )
    with pytest.raises(BrowserCommandError) as failure:
        session.request("POST", "/session/test/execute/sync", {})
    assert failure.value.code == code
    assert failure.value.retryable is retryable
    assert "PRIVATE" not in str(failure.value)
