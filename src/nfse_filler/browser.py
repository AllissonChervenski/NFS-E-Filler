"""Cliente mínimo do protocolo WebDriver para um ChromeDriver local.

As credenciais são digitadas pelo usuário diretamente no navegador. Apenas
campos do DPS são preenchidos; este módulo nunca clica em Avançar ou Emitir.
"""

import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import ProxyHandler, Request, build_opener

from .domain import PORTAL_URL, STEPS

ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf"
FIELD_DELAY = 0.6
STABLE_FOR = 0.6
FIELD_TIMEOUT = 30
POLL_INTERVAL = 0.2


class BrowserError(RuntimeError):
    pass


class BrowserCommandError(BrowserError):
    """Erro estruturado do WebDriver, sem reproduzir valores ou stack traces."""

    RETRYABLE = {
        "stale element reference",
        "element click intercepted",
        "element not interactable",
        "invalid element state",
        "no such element",
        "detached shadow root",
    }

    def __init__(self, code):
        self.code = code
        self.retryable = code in self.RETRYABLE
        messages = {
            "invalid session id": "A sessão do navegador foi encerrada. Abra o portal novamente.",
            "no such window": "A janela do portal foi fechada. Abra o portal novamente.",
            "session not created": "Não foi possível iniciar a sessão. Confira a compatibilidade entre Chrome/Chromium e ChromeDriver.",
            "javascript error": "O script de preenchimento falhou na página (javascript error). Inspecione os campos para conferir a estrutura atual.",
        }
        super().__init__(
            messages.get(
                code,
                "O portal atualizou ou bloqueou o controle durante a ação."
                if self.retryable
                else "O navegador não conseguiu executar a ação solicitada.",
            )
        )


class ChromeSession:
    def __init__(self, profile):
        self.profile = Path(profile).resolve()
        self.process = None
        self.session_id = None
        self.base_url = None
        self.http = build_opener(ProxyHandler({}))
        self.stop_event = threading.Event()

    def request(self, method, path, payload=None):
        if self.stop_event.is_set() and method != "DELETE":
            raise BrowserError("Operação interrompida ao encerrar o aplicativo.")
        request = Request(
            self.base_url + path,
            method=method,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={"Content-Type": "application/json"},
        )
        try:
            with self.http.open(request, timeout=40) as response:
                result = json.load(response)
        except HTTPError as error:
            try:
                code = json.load(error).get("value", {}).get("error", "webdriver error")
            except (ValueError, AttributeError, OSError):
                code = "webdriver error"
            finally:
                error.close()
            if not isinstance(code, str):
                code = "webdriver error"
            raise BrowserCommandError(code) from error
        except (URLError, TimeoutError, OSError) as error:
            raise BrowserError("Sem conexão com o navegador. Abra o portal novamente.") from error
        return result.get("value")

    def command(self, method, path, payload=None):
        if not self.session_id:
            raise BrowserError("Clique em Abrir portal e entre na sua conta primeiro.")
        return self.request(method, f"/session/{self.session_id}{path}", payload)

    def start(self, *, headless=False):
        if self.session_id:
            try:
                self.command("GET", "/url")
                return
            except BrowserError:
                self.close()
        driver = os.environ.get("NFSE_CHROMEDRIVER") or shutil.which("chromedriver")
        if not driver:
            raise BrowserError(
                "ChromeDriver não encontrado. Instale Chrome/Chromium e ChromeDriver compatíveis "
                "ou defina NFSE_CHROMEDRIVER. Veja as instruções no README."
            )
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        self.base_url = f"http://127.0.0.1:{port}"
        self.profile.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            self.process = subprocess.Popen(
                [driver, f"--port={port}", "--allowed-ips=127.0.0.1"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            for _ in range(50):
                if self.process.poll() is not None:
                    raise BrowserError("ChromeDriver encerrou antes de iniciar o navegador.")
                try:
                    self.request("GET", "/status")
                    break
                except BrowserError:
                    time.sleep(0.1)
            else:
                raise BrowserError("ChromeDriver demorou demais para iniciar.")
            args = [
                f"--user-data-dir={self.profile}",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-dev-shm-usage",
            ]
            if headless:
                args += ["--headless=new", "--window-size=1440,1080"]
            options = {
                "args": args,
                "prefs": {
                    "credentials_enable_service": False,
                    "profile.password_manager_enabled": False,
                },
            }
            binary = os.environ.get("NFSE_BROWSER_BINARY") or shutil.which("chromium")
            if binary:
                options["binary"] = binary
            result = self.request(
                "POST",
                "/session",
                {
                    "capabilities": {
                        "alwaysMatch": {
                            "browserName": "chrome",
                            "goog:chromeOptions": options,
                            "timeouts": {"pageLoad": 30000, "script": 10000},
                        }
                    }
                },
            )
            self.session_id = result["sessionId"]
        except (BrowserError, OSError) as error:
            self.close()
            if isinstance(error, BrowserError):
                raise
            raise BrowserError(
                "Não foi possível iniciar o navegador. Verifique a instalação."
            ) from error

    def execute(self, script, *args):
        return self.command("POST", "/execute/sync", {"script": script, "args": list(args)})

    def navigate(self, url):
        self.command("POST", "/url", {"url": url})

    def click(self, element):
        self.command("POST", f"/element/{element[ELEMENT_KEY]}/click", {})

    def type_text(self, element, value):
        path = f"/element/{element[ELEMENT_KEY]}"
        self.command("POST", path + "/clear", {})
        self.command("POST", path + "/value", {"text": str(value)})

    def portal_page(self):
        """Seleciona a única aba DPS, inclusive após login em janela separada."""
        matches = []
        handles = self.command("GET", "/window/handles")
        for handle in handles:
            self.command("POST", "/window", {"handle": handle})
            url = urlsplit(self.command("GET", "/url"))
            if (
                url.scheme == "https"
                and url.hostname == "www.nfse.gov.br"
                and url.path.startswith("/EmissorNacional/DPS/")
            ):
                matches.append((handle, url.path))
        if len(matches) != 1:
            raise BrowserError(
                "Deixe uma única aba de Emissão Completa aberta no navegador do assistente. "
                "Conclua o login e abra a etapa que deseja preencher."
            )
        self.command("POST", "/window", {"handle": matches[0][0]})
        return matches[0][1]

    def close(self):
        if self.session_id:
            try:
                self.command("DELETE", "")
            except BrowserError:
                pass
        self.session_id = None
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
        self.process = None


class Automation:
    def __init__(self, directory, session_factory=ChromeSession):
        self.session = session_factory(Path(directory) / "browser-profile")
        self.lock = threading.Lock()
        self.worker = None
        self.state = {
            "busy": False,
            "status": "idle",
            "message": "Portal ainda não aberto.",
            "completed": [],
            "failed_field": None,
            "diagnostics": None,
        }
        common_script = (Path(__file__).parent / "static" / "portal_match.js").read_text(
            encoding="utf-8"
        )
        self.script = (
            common_script
            + "\n"
            + (Path(__file__).parent / "static" / "portal.js").read_text(encoding="utf-8")
        )
        self.options_script = (
            common_script
            + "\n"
            + (Path(__file__).parent / "static" / "portal_options.js").read_text(encoding="utf-8")
        )
        self.inspect_script = (Path(__file__).parent / "static" / "portal_inspect.js").read_text(
            encoding="utf-8"
        )

    def status(self):
        with self.lock:
            return {**self.state, "completed": list(self.state["completed"])}

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def submit(self, action, invoice=None, step=None, selectors=None):
        if action not in {"open", "fill", "inspect"} or (action == "fill" and step not in STEPS):
            raise BrowserError("Ação ou etapa inválida.")
        with self.lock:
            if self.state["busy"]:
                raise BrowserError("Aguarde o preenchimento em andamento.")
            self.state = {
                "busy": True,
                "status": "running",
                "message": "Iniciando…",
                "completed": [],
                "failed_field": None,
                "diagnostics": None,
            }
        self.worker = threading.Thread(
            target=self._run, args=(action, invoice, step, selectors or {}), daemon=True
        )
        self.worker.start()

    def _run(self, action, invoice, step, selectors):
        current_label = None
        try:
            if action == "open":
                self.session.start()
                # Abrir novamente recupera a janela sem apagar o formulário em andamento.
                current = self.session.command("GET", "/url")
                if not current.startswith("https://www.nfse.gov.br/EmissorNacional/"):
                    self.session.navigate(PORTAL_URL)
                self.update(
                    status="ready", message="Entre no portal e abra Nova NFS-e → Emissão Completa."
                )
            elif action == "inspect":
                self.session.portal_page()
                report = self.session.execute(self.inspect_script)
                if report.get("status") != "inspected":
                    raise BrowserError("Abra uma etapa da Emissão Completa antes de inspecionar.")
                self.update(
                    status="done",
                    diagnostics=report,
                    message="Campos inspecionados. Baixe o diagnóstico para conferir o mapeamento.",
                )
            else:
                current_path = self.session.portal_page()
                fields = next(s["fields"] for s in invoice["steps"] if s["key"] == step)
                anchor_key = {
                    "people": "competence",
                    "service": "national_tax",
                    "values": "service_value",
                }[step]
                anchor = next(f for f in fields if f["key"] == anchor_key)
                # As rotas confirmadas identificam a etapa mesmo quando os campos
                # dependentes ainda estão bloqueados (IBS/CBS, país e município).
                known_routes = {
                    "people": "/emissornacional/dps/pessoas",
                    "service": "/emissornacional/dps/servico",
                    "values": "/emissornacional/dps/tributacao",
                }
                known_step = isinstance(current_path, str) and current_path.rstrip(
                    "/"
                ).lower() == known_routes.get(step)
                probe = (
                    {"status": "present"}
                    if known_step
                    else self.session.execute(
                        self.script, anchor, selectors.get(anchor_key, ""), [], None, True
                    )
                )
                if probe["status"] != "present":
                    self.update(failed_field=anchor_key)
                    raise BrowserError(
                        f"Não foi possível identificar a etapa {STEPS[step]}. Abra essa etapa "
                        f"no portal e confira o mapeamento de {anchor['label']}. "
                        "Use Inspecionar campos para obter os seletores disponíveis. "
                        "Nenhum campo foi alterado nesta tentativa."
                    )
                used = []
                completed = []
                for f in fields:
                    current_label = f["label"]
                    self.update(message=f"Preenchendo: {f['label']}…", failed_field=f["key"])
                    result = self._fill_field(f, selectors.get(f["key"], ""), used)
                    if result["status"] != "filled":
                        detail = {
                            "missing": "Campo não encontrado. Confira a etapa e o mapeamento.",
                            "not_ready": "O portal ainda mantém este campo oculto ou bloqueado. Confira as escolhas anteriores e tente novamente.",
                            "ambiguous": "Há mais de um campo com esse rótulo. Configure um seletor específico.",
                            "duplicate": "Este campo aponta para outro já preenchido. Corrija o mapeamento.",
                            "option_missing": "A opção configurada não está disponível no portal.",
                            "unsupported": "Este controle precisa de preenchimento manual ou ajuste no mapeamento.",
                            "search_unavailable": "A lista abriu, mas o campo de busca não ficou disponível. Selecione a opção no portal e tente novamente.",
                            "invalid_selector": "O seletor CSS informado é inválido.",
                            "rejected": "O portal não manteve o valor informado. Confira o campo manualmente.",
                            "unstable": "O valor não permaneceu confirmado após as atualizações do portal. O próximo campo não foi preenchido.",
                            "wrong_page": "Abra a etapa da Emissão Completa no portal oficial.",
                        }.get(result["status"], "O campo não pôde ser preenchido.")
                        raise BrowserError(
                            f"{detail} Use Inspecionar campos para conferir o mapeamento. "
                            "Os campos anteriores permanecem preenchidos."
                        )
                    used.append(result["target"])
                    completed.append(f["label"])
                    self.update(completed=list(completed), failed_field=None)
                self.update(
                    status="done",
                    message=f"Etapa {STEPS[step]} preenchida. Confira no portal "
                    "e avance por lá quando estiver pronto.",
                )
        except BrowserError as error:
            self.update(
                status="error", message=f"{current_label}: {error}" if current_label else str(error)
            )
        except Exception:
            self.update(
                status="error",
                message="A operação foi interrompida. Confira a janela do portal "
                "e tente novamente. Nenhuma emissão foi solicitada.",
            )
        finally:
            self.update(busy=False)

    def _fill_field(self, field, selector, used):
        """Escreve, aguarda o portal e confirma estabilidade antes de prosseguir."""
        deadline = time.monotonic() + FIELD_TIMEOUT
        written = False
        stable_since = None
        stable_target = None
        result = {"status": "not_ready"}
        pending = {"missing", "option_missing", "not_ready", "search_unavailable", "rejected"}
        while time.monotonic() < deadline:
            try:
                if not written:
                    result = self.session.execute(self.script, field, selector, used)
                    if result["status"] == "search":
                        result = self._search_option(field, result)
                    if result["status"] == "filled":
                        written = True
                        stable_since = None
                        self.update(message=f"Aguardando confirmação: {field['label']}…")
                        time.sleep(FIELD_DELAY)
                        continue
                    if result["status"] not in pending:
                        return result
                else:
                    result = self.session.execute(
                        self.script, field, selector, [], None, False, "verify"
                    )
                    if result["status"] == "confirmed":
                        now = time.monotonic()
                        if stable_since is None or stable_target != result["target"]:
                            stable_since, stable_target = now, result["target"]
                        if now - stable_since >= STABLE_FOR:
                            return {"status": "filled", "target": result["target"]}
                    else:
                        stable_since = None
                        if result["status"] == "rejected":
                            written = False
                        elif result["status"] not in pending:
                            return result
            except BrowserCommandError as error:
                if not error.retryable:
                    raise
                # Referências de elementos podem expirar durante a resposta AJAX.
                # A próxima tentativa procura o controle novamente pelo seletor.
                written = False
                stable_since = None
                result = {"status": "not_ready"}
            time.sleep(POLL_INTERVAL)
        return (
            {"status": "unstable"}
            if result["status"] in {"filled", "confirmed", "rejected"}
            else result
        )

    def _search_option(self, field, result):
        key = field.get("key")
        if result.get("opener"):
            opened = False
            deadline = time.monotonic() + 5
            while True:
                search = self.session.execute(
                    self.options_script, field["value"], "input", result["target"], None, key
                )
                if search["status"] != "missing" or time.monotonic() >= deadline:
                    break
                if not opened:
                    self.session.click(result["opener"])
                    opened = True
                time.sleep(0.2)
            if search["status"] != "input":
                return {"status": "search_unavailable"} if search["status"] == "missing" else search
            search_input = search["input"]
        else:
            search_input = result["input"]
        query = field["value"]
        if key == "municipality":
            query = re.sub(r"\s*(?:/|[-–]|\()\s*[A-Za-z]{2}\)?$", "", query).strip()
        self.session.type_text(search_input, query)
        deadline = time.monotonic() + 8
        while True:
            match = self.session.execute(
                self.options_script, field["value"], "option", result["target"], None, key
            )
            if match["status"] != "option_missing" or time.monotonic() >= deadline:
                break
            time.sleep(0.2)
        if match["status"] != "option":
            return match
        self.session.click(match["option"])
        verification = self.session.execute(
            self.options_script, field["value"], "verify", result["target"], None, key
        )
        return {**verification, "target": result["target"]}

    def close(self):
        if hasattr(self.session, "stop_event"):
            self.session.stop_event.set()
        if self.worker:
            self.worker.join(timeout=45)
        if not self.worker or not self.worker.is_alive():
            self.session.close()
