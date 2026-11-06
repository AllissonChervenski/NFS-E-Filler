"""Consulta opcional pela sessão do Light Web, sem alterar a hospedagem."""

import re
import threading
import time
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

from .browser import BrowserCommandError, BrowserError, ChromeSession
from .domain import ValidationError, decimal_value, normalize_document, valid_document
from .storage import SettingsStore

HOST = "desbravadorweb.com.br"
LOGIN_URL = "https://desbravadorweb.com.br/acesso/3672"
MAPPING_FIELDS = {
    "scope": "Área dos dados da hospedagem",
    "room_card": "Card do quarto no mapa (use {room} para o número)",
    "room": "Número do quarto na hospedagem aberta",
    "guest_name": "Nome do hóspede",
    "check_in": "Data de check-in",
    "check_out": "Data de check-out",
    "lodging_total": "Subtotal de diárias, sem consumo",
    "customer_document": "CPF/CNPJ do titular (automático quando em branco)",
}
REQUIRED_FIELDS = {"room", "guest_name", "check_in", "check_out", "lodging_total"}
LIGHTWEB_ROOM_CARDS = "#mapa-uhs-conteudo .uh-main"
LIGHTWEB_SELECTORS = {
    "scope": "#conteudo-ajax",
    "room_card": LIGHTWEB_ROOM_CARDS,
    "room": "#hospedagemForm-uhSelecionada-abreviatura",
    "guest_name": "#hospedagemForm-titular",
    "check_in": "#hospedagemForm-dataIn",
    "check_out": "#hospedagemForm-dataOut",
    "lodging_total": "#hospedagemTarifa-totalTarifas",
    "customer_document": "",
}


def defaults():
    return {
        "login_url": LOGIN_URL,
        "selectors": dict(LIGHTWEB_SELECTORS),
    }


def validate_config(data):
    if not isinstance(data, dict) or set(data) != {"login_url", "selectors"}:
        raise ValidationError("Configuração do Desbravador inválida.")
    url = data["login_url"]
    if not isinstance(url, str):
        raise ValidationError("Informe o endereço de acesso do Desbravador.")
    try:
        parsed = urlsplit(url.strip())
    except ValueError:
        raise ValidationError("Endereço de acesso do Desbravador inválido.") from None
    if (
        parsed.scheme != "https"
        or parsed.netloc != HOST
        or parsed.query
        or parsed.fragment
        or not re.fullmatch(r"/acesso/[0-9]+/?", parsed.path)
    ):
        raise ValidationError(
            "Use o endereço https://desbravadorweb.com.br/acesso/codigo_do_hotel."
        )
    selectors = data["selectors"]
    if not isinstance(selectors, dict) or set(selectors) != set(MAPPING_FIELDS):
        raise ValidationError("Mapeamento do Desbravador inválido.")
    if any(not isinstance(v, str) or len(v) > 500 for v in selectors.values()):
        raise ValidationError("Cada seletor deve ter até 500 caracteres.")
    if (
        selectors["room_card"].strip()
        and "{room}" not in selectors["room_card"]
        and selectors["room_card"].strip() != LIGHTWEB_ROOM_CARDS
    ):
        raise ValidationError("O seletor do card deve incluir {room} para identificar o quarto.")
    cleaned = {k: v.strip() for k, v in selectors.items()}
    # Migra somente o mapeamento inicialmente vazio da primeira versão.
    if all(not cleaned[k] for k in REQUIRED_FIELDS):
        cleaned = dict(LIGHTWEB_SELECTORS)
    return {"login_url": url.strip(), "selectors": cleaned}


def validate_room(room):
    if not isinstance(room, str) or not re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9 -]{0,19}", room.strip()
    ):
        raise ValidationError("Informe o quarto a consultar (até 20 caracteres).")
    return room.strip()


def hotel_date(raw):
    if not isinstance(raw, str):
        raise ValidationError("Data não identificada no Desbravador.")
    # A leitura pode incluir o horário; a descrição da nota usa apenas a data.
    match = re.fullmatch(
        r"([0-9]{2})/([0-9]{2})/([0-9]{4})(?: [0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?", raw.strip()
    )
    try:
        if match:
            day, month, year = map(int, match.groups())
            return date(year, month, day)
        if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw.strip()):
            raise ValueError
        return date.fromisoformat(raw.strip())
    except ValueError:
        raise ValidationError("Confira o mapeamento das datas do Desbravador.") from None


def normalize_stay(raw, requested_room):
    if not isinstance(raw, dict):
        raise ValidationError("Não foi possível ler a hospedagem.")
    room = validate_room(raw.get("room"))

    def canonical(value):
        return value.lstrip("0") or "0" if value.isdigit() else value.upper()

    if canonical(room) != canonical(requested_room):
        raise ValidationError("O quarto aberto não corresponde ao quarto solicitado.")
    name = raw.get("guest_name", "")
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValidationError("Nome do hóspede não identificado. Confira o mapeamento.")
    check_in, check_out = hotel_date(raw.get("check_in")), hotel_date(raw.get("check_out"))
    if check_out <= check_in:
        raise ValidationError("O check-out lido deve ser posterior ao check-in.")
    amount = raw.get("lodging_total", "")
    if not isinstance(amount, str):
        raise ValidationError("Subtotal das diárias não identificado.")
    amount = re.sub(r"^R\$\s*", "", amount.strip())
    if not re.fullmatch(r"[0-9.,]+", amount):
        tokens = re.findall(r"(?:[0-9]{1,3}(?:\.[0-9]{3})+|[0-9]+),[0-9]{2}", amount)
        if len(tokens) != 1:
            raise ValidationError(
                "O total de tarifas contém mais de um valor ou não foi identificado."
            )
        amount = tokens[0]
    amount = decimal_value(amount, "Subtotal de diárias")
    document = raw.get("customer_document", "")
    document = normalize_document(document) if valid_document(document) else ""
    return {
        "room": room,
        "guest_name": name.strip(),
        "check_in": check_in.strftime("%d/%m/%Y"),
        "check_out": check_out.strftime("%d/%m/%Y"),
        "service_value": str(amount).replace(".", ","),
        "customer_document": document,
    }


class Desbravador:
    def __init__(self, directory, session_factory=ChromeSession):
        self.store = SettingsStore(
            directory,
            filename="desbravador.json",
            defaults_factory=defaults,
            validator=validate_config,
        )
        self.session = session_factory(Path(directory) / "desbravador-profile")
        static = Path(__file__).parent / "static"
        self.script = (
            (static / "desbravador_data.js").read_text(encoding="utf-8")
            + "\n"
            + (static / "desbravador.js").read_text(encoding="utf-8")
        )
        self.lock = threading.Lock()
        self.worker = None
        self.counter = 0
        self.opened_login_url = None
        self.state = {
            "busy": False,
            "id": 0,
            "status": "idle",
            "message": "Consulta por quarto opcional.",
            "result": None,
            "diagnostics": None,
        }

    def status(self):
        with self.lock:
            return dict(self.state)

    def update(self, **values):
        with self.lock:
            self.state.update(values)

    def submit(self, action, room=None):
        if action not in {"open", "lookup", "inspect"}:
            raise ValidationError("Ação inválida para o Desbravador.")
        if action == "lookup":
            room = validate_room(room)
        with self.lock:
            if self.state["busy"]:
                raise BrowserError("Aguarde a consulta ao Desbravador em andamento.")
            self.counter += 1
            self.state = {
                "busy": True,
                "id": self.counter,
                "status": "running",
                "message": "Consultando Desbravador…",
                "result": None,
                "diagnostics": None,
            }
        self.worker = threading.Thread(target=self._run, args=(action, room), daemon=True)
        self.worker.start()

    def select_page(self):
        if not self.session.session_id:
            raise BrowserError("Clique em Abrir Desbravador e faça login antes de consultar.")
        matches = []
        for handle in self.session.command("GET", "/window/handles"):
            self.session.command("POST", "/window", {"handle": handle})
            url = urlsplit(self.session.command("GET", "/url"))
            if url.scheme == "https" and url.netloc == HOST:
                matches.append(handle)
        if len(matches) != 1:
            raise BrowserError(
                "Mantenha uma única aba do Desbravador na janela aberta pelo assistente e faça login."
            )
        self.session.command("POST", "/window", {"handle": matches[0]})

    def _run(self, action, room):
        try:
            config = self.store.load()
            if action == "open":
                self.session.start()
                url = urlsplit(self.session.command("GET", "/url"))
                if (
                    url.scheme != "https"
                    or url.netloc != HOST
                    or self.opened_login_url != config["login_url"]
                ):
                    self.session.navigate(config["login_url"])
                self.opened_login_url = config["login_url"]
                self.update(
                    status="ready",
                    message="Faça login no Desbravador e abra o mapa de UH ou a hospedagem.",
                )
                return
            self.select_page()
            if self.opened_login_url and self.opened_login_url != config["login_url"]:
                raise BrowserError(
                    "O endereço do hotel mudou. Clique em Abrir Desbravador para acessar o hotel configurado."
                )
            selectors = config["selectors"]
            if action == "inspect":
                deadline = time.monotonic() + 20
                while True:
                    report = self.session.execute(self.script, "inspect", selectors, "")
                    if report.get("status") != "loading" or time.monotonic() >= deadline:
                        break
                    time.sleep(0.2)
                if report.get("status") != "inspected":
                    raise BrowserError(self.describe(report))
                self.update(
                    status="done",
                    diagnostics=report,
                    message="Estrutura carregada inspecionada. Baixe o diagnóstico para mapear os dados.",
                )
                return
            if not all(selectors[k] for k in REQUIRED_FIELDS):
                raise BrowserError(
                    "O mapa e os dados do quarto são carregados por JavaScript. Use Inspecionar tela no mapa e dentro de uma hospedagem para concluir o mapeamento antes da consulta."
                )
            located = False
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                try:
                    result = self.session.execute(
                        self.script, "read" if located else "locate", selectors, room
                    )
                except BrowserCommandError as error:
                    if not error.retryable:
                        raise
                    time.sleep(0.2)
                    continue
                if result["status"] == "located":
                    located = True
                elif result["status"] == "read":
                    self.update(
                        status="done",
                        result=normalize_stay(result["data"], room),
                        message="Hospedagem consultada. Confira os dados importados e ajuste o tomador se necessário.",
                    )
                    return
                elif result["status"] not in {
                    "not_ready", "loading", "opening_card", "opening_statement"
                }:
                    raise BrowserError(self.describe(result))
                time.sleep(0.2)
            raise BrowserError(
                "O Desbravador não concluiu o carregamento. Confira a hospedagem aberta e inspecione a tela."
            )
        except (BrowserError, ValidationError) as error:
            self.update(status="error", message=str(error))
        except Exception:
            self.update(
                status="error",
                message="Não foi possível consultar o Desbravador. Nenhum dado foi aplicado ao formulário.",
            )
        finally:
            self.update(busy=False)

    @staticmethod
    def describe(result):
        return {
            "wrong_page": "Abra o Desbravador e faça login na janela do assistente.",
            "empty": "A área dinâmica está vazia. Aguarde o mapa ou a hospedagem aparecer antes de inspecionar.",
            "ambiguous": "O seletor encontrou mais de um resultado. Refine a área e o mapeamento da hospedagem.",
            "invalid_selector": "Seletor CSS inválido no mapeamento do Desbravador.",
            "wrong_room": "O quarto aberto difere do solicitado. Abra o mapa ou o quarto correto.",
            "card_not_opened": "Não foi possível abrir o menu do quarto no mapa de UH.",
            "missing": "Campo não identificado na hospedagem. Confira o mapeamento após inspecionar a tela.",
        }.get(result.get("status"), "Não foi possível ler os dados da hospedagem.")

    def close(self):
        self.session.stop_event.set()
        if self.worker:
            self.worker.join(45)
        if not self.worker or not self.worker.is_alive():
            self.session.close()
