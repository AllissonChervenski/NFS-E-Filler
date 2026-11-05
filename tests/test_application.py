import io
import json
from email.message import Message
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from nfse_filler.domain import ValidationError
from nfse_filler.server import Application, handler_for


def test_save_reload_preview_and_fill_use_saved_values(tmp_path, invoice_data):
    app = Application(tmp_path)
    settings = app.dispatch("GET", "/api/state")["settings"]
    settings["values"]["municipality"] = "Teste/RS"
    app.dispatch("POST", "/api/settings", settings)
    restarted = Application(tmp_path)
    assert restarted.dispatch("GET", "/api/state")["settings"] == settings
    preview = restarted.dispatch("POST", "/api/preview", invoice_data)
    restarted.automation.submit = Mock()
    restarted.dispatch(
        "POST",
        "/api/browser/fill",
        {
            "step": "service",
            "invoice": invoice_data,
            "settings_signature": preview["settings_signature"],
        },
    )
    call = restarted.automation.submit.call_args.args
    assert call[0] == "fill"
    fields = {f["key"]: f["value"] for s in call[1]["steps"] for f in s["fields"]}
    assert fields["municipality"] == "Teste/RS"
    assert not list(tmp_path.glob("*invoice*"))


def test_concurrent_configuration_change_requires_new_preview(tmp_path, invoice_data):
    app = Application(tmp_path)
    preview = app.dispatch("POST", "/api/preview", invoice_data)
    settings = app.store.load()
    settings["values"]["simple_rate"] = "10,00"
    app.store.save(settings)
    with pytest.raises(ValidationError, match="configurações mudaram"):
        app.dispatch(
            "POST",
            "/api/browser/fill",
            {
                "step": "values",
                "invoice": invoice_data,
                "settings_signature": preview["settings_signature"],
            },
        )


def request_handler(tmp_path, *, host="127.0.0.1:8765", origin=None, token=None):
    cls = handler_for(Application(tmp_path))
    handler = object.__new__(cls)
    handler.headers = Message()
    handler.headers["Host"] = host
    if origin:
        handler.headers["Origin"] = origin
    if token:
        handler.headers["X-NFSE-Request"] = token
    handler.server = SimpleNamespace(server_port=8765)
    handler.send_data = Mock()
    return handler


@pytest.mark.parametrize(
    ("host", "origin", "token", "expected"),
    [
        ("127.0.0.1:8765", "http://127.0.0.1:8765", "local", True),
        ("localhost:8765", None, "local", True),
        ("evil.test:8765", None, "local", False),
        ("127.0.0.1:8765", "https://evil.test", "local", False),
        ("127.0.0.1:8765", None, None, False),
    ],
)
def test_local_api_rejects_untrusted_origins(tmp_path, host, origin, token, expected):
    handler = request_handler(tmp_path, host=host, origin=origin, token=token)
    assert handler.trusted_request(mutation=True) is expected


def test_http_preview_roundtrip(tmp_path, invoice_data):
    handler = request_handler(tmp_path, token="local")
    payload = json.dumps(invoice_data).encode()
    handler.path = "/api/preview"
    handler.headers["Content-Type"] = "application/json"
    handler.headers["Content-Length"] = str(len(payload))
    handler.rfile = io.BytesIO(payload)
    handler.do_POST()
    assert handler.send_data.call_args.args[0] == 200
    assert handler.send_data.call_args.args[1]["amount"] == "1250.00"


def test_static_path_traversal_is_rejected(tmp_path):
    handler = request_handler(tmp_path)
    handler.path = "/../../data/settings.json"
    handler.do_GET()
    assert handler.send_data.call_args.args[0] == 404


def test_oversized_payload_is_rejected_without_reading(tmp_path):
    handler = request_handler(tmp_path, token="local")
    handler.headers["Content-Type"] = "application/json"
    handler.headers["Content-Length"] = "999999"
    handler.rfile = Mock()
    handler.do_POST()
    assert handler.send_data.call_args.args[0] == 413
    handler.rfile.read.assert_not_called()


def test_inspect_api_does_not_require_invoice_or_settings(tmp_path):
    app = Application(tmp_path)
    app.automation.submit = Mock()
    app.dispatch("POST", "/api/browser/inspect", {})
    app.automation.submit.assert_called_once_with("inspect")
