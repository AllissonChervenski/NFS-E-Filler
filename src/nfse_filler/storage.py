"""Configurações persistentes; não armazena dados das hospedagens."""

import json
import os
import tempfile
import threading
from pathlib import Path

from .domain import FIELDS, ValidationError, validate_settings


class SettingsStore:
    def __init__(
        self,
        directory,
        *,
        filename="settings.json",
        defaults_factory=None,
        validator=validate_settings,
    ):
        self.directory = Path(directory)
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = self.directory / filename
        self.lock = threading.RLock()
        self.defaults_factory = defaults_factory or (
            lambda: {
                "values": {f["key"]: f["default"] for f in FIELDS},
                "selectors": {},
            }
        )
        self.validator = validator

    def load(self):
        with self.lock:
            if not self.path.exists():
                return self.defaults_factory()
            try:
                return self.validator(json.loads(self.path.read_text(encoding="utf-8")))
            except (OSError, ValueError) as error:
                raise ValidationError(
                    f"Não foi possível ler {self.path.name}. Corrija ou restaure esse arquivo; "
                    "suas configurações não foram sobrescritas."
                ) from error

    def save(self, data):
        validated = self.validator(data)
        with self.lock:
            fd, temporary = tempfile.mkstemp(prefix="settings-", suffix=".tmp", dir=self.directory)
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as stream:
                    json.dump(validated, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        return validated
