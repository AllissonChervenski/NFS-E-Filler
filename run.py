"""Executa a aplicação diretamente do checkout, sem instalação de pacotes."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from nfse_filler.server import main  # noqa: E402

if __name__ == "__main__":
    if not getattr(sys, "frozen", False):
        os.environ.setdefault("NFSE_DATA_DIR", str(Path(__file__).resolve().parent / "data"))
    raise SystemExit(main())
