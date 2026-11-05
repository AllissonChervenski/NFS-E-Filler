import json
import os

import pytest

from nfse_filler.domain import ValidationError
from nfse_filler.storage import SettingsStore


def test_last_saved_settings_are_loaded_on_restart(tmp_path, settings):
    store = SettingsStore(tmp_path)
    settings["values"]["municipality"] = "Porto Alegre/RS"
    settings["values"]["simple_rate"] = "6,50"
    settings["selectors"]["cst"] = "#situacao"
    store.save(settings)
    assert SettingsStore(tmp_path).load() == settings
    assert not list(tmp_path.glob("*.tmp"))
    if os.name == "posix":
        assert store.path.stat().st_mode & 0o777 == 0o600


def test_invalid_save_keeps_previous_settings(tmp_path, settings):
    store = SettingsStore(tmp_path)
    store.save(settings)
    original = store.path.read_bytes()
    settings["values"]["simple_rate"] = "abc"
    with pytest.raises(ValidationError):
        store.save(settings)
    assert store.path.read_bytes() == original


def test_corrupt_settings_are_not_silently_reset(tmp_path):
    store = SettingsStore(tmp_path)
    store.path.write_text("invalid JSON", encoding="utf-8")
    with pytest.raises(ValidationError, match="não foram sobrescritas"):
        store.load()
    assert store.path.read_text() == "invalid JSON"


def test_failed_atomic_replace_keeps_old_settings(tmp_path, settings, monkeypatch):
    store = SettingsStore(tmp_path)
    store.save(settings)
    original = store.path.read_bytes()

    def fail(*args):
        raise OSError("disk error")

    monkeypatch.setattr(os, "replace", fail)
    settings["values"]["simple_rate"] = "5"
    with pytest.raises(OSError):
        store.save(settings)
    assert store.path.read_bytes() == original
    assert json.loads(original)["values"]["simple_rate"] == "12,48"
    assert not list(tmp_path.glob("*.tmp"))
