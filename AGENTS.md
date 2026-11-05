# Repository Guidelines

## Project Structure & Module Organization

`preenchimento.md` is the source workflow for lodging invoices. Keep its fixed values
consistent with `src/nfse_filler/domain.py`. The Python package contains validation
(`domain.py`), atomic settings storage (`storage.py`), the local HTTP interface
(`server.py`), and ChromeDriver integration (`browser.py`). HTML, CSS, and JavaScript
live in `src/nfse_filler/static/`. Tests and fictional portal fixtures are in `tests/`.
Runtime settings and the browser profile belong in ignored `data/`.

## Build, Test, and Development Commands

- `python run.py`: start the application at `http://127.0.0.1:8765`; no build or runtime
  Python dependencies are required.
- `python run.py --no-open --port 8766`: run without automatically opening the interface.
- `python -m venv .venv` and `.venv/bin/python -m pip install -e '.[dev]'`: install development tools.
- `.venv/bin/python -B -m pytest -q -p no:cacheprovider`: run automated tests.
- `.venv/bin/ruff check --no-cache src tests run.py`: check Python style.
- `.venv/bin/ruff format --check src tests run.py`: verify formatting.
- `node --check src/nfse_filler/static/app.js`: check frontend syntax.

## Coding Style & Naming Conventions

Use Python 3.11+, four-space indentation, snake_case functions and modules, and
PascalCase classes. Ruff defines formatting and lint rules in `pyproject.toml`.
Use two-space indentation in JavaScript and Portuguese for interface text and
actionable errors. Keep monetary calculations in `Decimal`. Insert user content
through `textContent`, never interpolated HTML.

## Testing Guidelines

Use pytest with `test_*.py` files and `test_*` functions. Cover invalid dates,
document check digits, decimal amounts, saved settings across restarts, and partial
automation failures. No numerical coverage threshold is configured. Optional browser
tests require matching Chromium/ChromeDriver and `NFSE_BROWSER_TESTS=1`; they use local
fixtures, never real invoice emission. Report skipped browser validation explicitly.

## Commit & Pull Request Guidelines

No usable Git history was available in this checkout to establish an existing
convention. Use concise imperative subjects, such as `Add persistent invoice settings`.
Describe the behavior changed, relevant tests, and remaining portal limitations.
Link applicable issues and include screenshots for visible interface changes.

## Security & Portal Automation

Keep the server bound to loopback. Preserve origin checks and stop on ambiguous
fields. Authentication and final emission remain manual. Never commit browser
profiles, credentials, guest information, or real tax documents.
