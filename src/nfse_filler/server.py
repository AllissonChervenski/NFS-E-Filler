"""Interface HTTP limitada ao computador local, usando apenas a biblioteca padrão."""

import argparse
import json
import mimetypes
import os
import sys
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .browser import Automation, BrowserError
from .desbravador import MAPPING_FIELDS, Desbravador
from .domain import (
    FIELDS,
    STEPS,
    VARIABLE_FIELDS,
    ValidationError,
    prepare_invoice,
    settings_signature,
)
from .storage import SettingsStore

STATIC = Path(__file__).parent / "static"
MAX_BODY = 64 * 1024


class Application:
    def __init__(self, directory):
        self.store = SettingsStore(directory)
        self.automation = Automation(directory)
        self.desbravador = Desbravador(directory)

    def dispatch(self, method, path, data=None):
        if method == "GET" and path == "/api/state":
            return {
                "settings": self.store.load(),
                "fields": FIELDS,
                "variable_fields": VARIABLE_FIELDS,
                "steps": STEPS,
                "automation": self.automation.status(),
            }
        if method == "GET" and path == "/api/status":
            return self.automation.status()
        if method == "GET" and path == "/api/desbravador/status":
            return self.desbravador.status()
        if method == "GET" and path == "/api/desbravador/config":
            return {"config": self.desbravador.store.load(), "mapping_fields": MAPPING_FIELDS}
        if method == "POST" and path == "/api/desbravador/config":
            if self.desbravador.status()["busy"]:
                raise BrowserError("Aguarde a consulta antes de mudar o mapeamento.")
            return self.desbravador.store.save(data)
        hotel_actions = {
            "/api/desbravador/open": "open",
            "/api/desbravador/inspect": "inspect",
            "/api/desbravador/lookup": "lookup",
        }
        if method == "POST" and path in hotel_actions:
            if not isinstance(data, dict):
                raise ValidationError("Dados da consulta inválidos.")
            self.desbravador.submit(hotel_actions[path], data.get("room"))
            return self.desbravador.status()
        if method == "POST" and path == "/api/settings":
            return self.store.save(data)
        if method == "POST" and path == "/api/preview":
            return prepare_invoice(data, self.store.load())
        if method == "POST" and path == "/api/browser/open":
            self.automation.submit("open")
            return self.automation.status()
        if method == "POST" and path == "/api/browser/inspect":
            self.automation.submit("inspect")
            return self.automation.status()
        if method == "POST" and path == "/api/browser/fill":
            if not isinstance(data, dict) or data.get("step") not in STEPS:
                raise ValidationError("Etapa inválida.")
            settings = self.store.load()
            if data.get("settings_signature") != settings_signature(settings):
                raise ValidationError(
                    "As configurações mudaram. Prepare o preenchimento novamente."
                )
            invoice = prepare_invoice(data.get("invoice"), settings)
            self.automation.submit("fill", invoice, data["step"], settings["selectors"])
            return self.automation.status()
        return None


def handler_for(application):
    class Handler(BaseHTTPRequestHandler):
        server_version = "NFSeLocal/0.1"

        def log_message(self, format, *args):
            # Não registrar documentos, nomes, formulários ou URLs enviados pelo usuário.
            pass

        def send_data(self, status, payload, content_type="application/json; charset=utf-8"):
            if not isinstance(payload, bytes):
                payload = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header(
                "Content-Security-Policy",
                "default-src 'self'; script-src 'self'; "
                "style-src 'self'; img-src 'self' data:; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            )
            self.end_headers()
            self.wfile.write(payload)

        def trusted_request(self, mutation=False):
            port = self.server.server_port
            hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
            host = self.headers.get("Host", "")
            if host not in hosts:
                return False
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{host}":
                return False
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                return False
            return not mutation or self.headers.get("X-NFSE-Request") == "local"

        def do_GET(self):
            if not self.trusted_request():
                self.send_data(403, {"error": "Acesso permitido somente pela interface local."})
                return
            path = urlsplit(self.path).path
            if path.startswith("/api/"):
                self.api("GET", path)
                return
            files = {
                "/": "index.html",
                "/app.js": "app.js",
                "/styles.css": "styles.css",
                "/dates.js": "dates.js",
                "/hotel_form.js": "hotel_form.js",
                "/hotel.js": "hotel.js",
            }
            if path not in files:
                self.send_data(404, {"error": "Página não encontrada."})
                return
            file = STATIC / files[path]
            mime = mimetypes.guess_type(str(file))[0] or "application/octet-stream"
            self.send_data(200, file.read_bytes(), mime + "; charset=utf-8")

        def do_POST(self):
            if not self.trusted_request(mutation=True):
                self.send_data(403, {"error": "Requisição não autorizada pela interface local."})
                return
            if self.headers.get_content_type() != "application/json":
                self.send_data(415, {"error": "Envie JSON."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > MAX_BODY:
                    self.send_data(413, {"error": "Tamanho de requisição inválido."})
                    return
                data = json.loads(self.rfile.read(length))
            except (ValueError, UnicodeDecodeError):
                self.send_data(400, {"error": "JSON inválido."})
                return
            self.api("POST", urlsplit(self.path).path, data)

        def api(self, method, path, data=None):
            try:
                result = application.dispatch(method, path, data)
                if result is None:
                    self.send_data(404, {"error": "Rota não encontrada."})
                else:
                    self.send_data(200, result)
            except ValidationError as error:
                self.send_data(400, {"error": str(error)})
            except BrowserError as error:
                self.send_data(409, {"error": str(error)})
            except OSError:
                self.send_data(
                    500,
                    {
                        "error": "Não foi possível acessar os dados locais. "
                        "Verifique as permissões da pasta de dados."
                    },
                )
            except Exception:
                self.send_data(500, {"error": "A operação não pôde ser concluída."})

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Assistente local de NFS-e para hospedagens")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--data-dir", type=Path, default=Path(os.environ.get("NFSE_DATA_DIR", "data"))
    )
    parser.add_argument(
        "--no-open", action="store_true", help="Não abrir a interface automaticamente"
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("A porta deve estar entre 1 e 65535.")
    app = Application(args.data_dir)
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(app))
    except OSError as error:
        print(f"Não foi possível abrir a porta {args.port}: {error}", file=sys.stderr)
        return 1
    url = f"http://127.0.0.1:{args.port}"
    print(
        f"NFS-e Hospedagem: {url}\nConfigurações: {app.store.path.resolve()}\nCtrl+C para encerrar.",
        flush=True,
    )
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        app.automation.close()
        app.desbravador.close()
    return 0
