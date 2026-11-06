"""Atualiza os arquivos compartilhados usados pela extensão sem dependências de build."""

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
from nfse_filler.domain import FIELDS, STEP_FIELDS, STEPS, VARIABLE_FIELDS  # noqa: E402
from nfse_filler.desbravador import LIGHTWEB_SELECTORS, MAPPING_FIELDS  # noqa: E402

STATIC = ROOT / "src/nfse_filler/static"
OUT = ROOT / "extension/runtime"
OUT.mkdir(parents=True, exist_ok=True)
for name in ("styles.css", "dates.js", "hotel_form.js"):
    shutil.copy2(STATIC / name, OUT / name)


def body(name):
    return (STATIC / name).read_text(encoding="utf-8")


def wrapped(name):
    return "function () {\n" + body(name) + "\n}"


(OUT / "portal_page.js").write_text(
    "window.NFSeExtensionPortal = (() => {\n"
    + body("portal_match.js")
    + "\nconst fill = "
    + wrapped("portal.js")
    + ";\nconst option = "
    + wrapped("portal_options.js")
    + ";\nconst inspect = "
    + wrapped("portal_inspect.js")
    + ";\nreturn {fill, option, inspect, matches: NFSePortalMatch.matches};\n})();\n",
    encoding="utf-8",
)
(OUT / "hotel_page.js").write_text(
    "window.NFSeExtensionHotel = (() => {\n"
    + body("desbravador_data.js")
    + "\nconst run = "
    + wrapped("desbravador.js")
    + ";\nreturn {run};\n})();\n",
    encoding="utf-8",
)
metadata = {
    "fields": FIELDS,
    "variable_fields": VARIABLE_FIELDS,
    "steps": STEPS,
    "step_fields": STEP_FIELDS,
    "hotel_selectors": LIGHTWEB_SELECTORS,
    "hotel_mapping_fields": MAPPING_FIELDS,
}
(OUT / "metadata.js").write_text(
    "window.NFSeExtensionMetadata = " + json.dumps(metadata, ensure_ascii=False) + ";\n",
    encoding="utf-8",
)
