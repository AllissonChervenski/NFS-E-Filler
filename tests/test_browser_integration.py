"""Testes opt-in com ChromeDriver; usam somente o app e formulários locais."""

import os
import threading
import time
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest

from nfse_filler.browser import ChromeSession
from nfse_filler.domain import ALL_FIELDS
from nfse_filler.server import Application, handler_for

pytestmark = pytest.mark.skipif(
    os.environ.get("NFSE_BROWSER_TESTS") != "1",
    reason="Defina NFSE_BROWSER_TESTS=1 em ambiente com Chromium e conexões locais permitidas.",
)


@pytest.fixture
def browser_app(tmp_path):
    app = Application(tmp_path / "data")
    base = handler_for(app)

    class FixtureHandler(base):
        def do_GET(self):
            if self.path in {
                "/fixture",
                "/fixture.js",
                "/fixture.css",
                "/hotel-fixture",
                "/hotel-fixture.js",
                "/hotel-lightweb",
                "/hotel-lightweb.js",
            }:
                name, mime = {
                    "/fixture": ("portal.html", "text/html"),
                    "/fixture.js": ("portal.js", "text/javascript"),
                    "/fixture.css": ("portal.css", "text/css"),
                    "/hotel-fixture": ("hotel.html", "text/html"),
                    "/hotel-fixture.js": ("hotel.js", "text/javascript"),
                    "/hotel-lightweb": ("hotel_lightweb.html", "text/html"),
                    "/hotel-lightweb.js": ("hotel_lightweb.js", "text/javascript"),
                }[self.path]
                self.send_data(
                    200,
                    (Path(__file__).parent / "fixtures" / name).read_bytes(),
                    mime + "; charset=utf-8",
                )
            else:
                super().do_GET()

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    session = ChromeSession(tmp_path / "qa-browser")
    origin = f"http://127.0.0.1:{server.server_port}"
    try:
        session.start(headless=True)
        yield session, origin, app
    finally:
        session.close()
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)


def until(session, expression):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if session.execute("return " + expression):
            return
        time.sleep(0.1)
    pytest.fail(f"Condição não satisfeita: {expression}")


def test_interface_preview_settings_and_reload(browser_app, invoice_data):
    browser, origin, _ = browser_app
    browser.navigate(origin)
    until(browser, "!document.querySelector('#invoice-form button[type=submit]').disabled")
    browser.execute(
        """
      for (const [key, value] of Object.entries(arguments[0])) {
        const el = document.querySelector(`[name="${key}"]`);
        el.value = value; el.dispatchEvent(new Event('input', {bubbles: true}));
      }
      document.querySelector('#invoice-form').requestSubmit();
    """,
        {**invoice_data, "check_in": "02/11/2026", "check_out": "05/11/2026"},
    )
    until(browser, "document.querySelector('#preview-state').textContent === 'Preparada'")
    assert "Hóspede de Teste" in browser.execute(
        "return document.querySelector('#preview-description').textContent"
    )
    browser.execute("""
      document.querySelector('#nav-settings').click();
      const el = document.querySelector('#setting-municipality');
      el.value = 'Porto Alegre/RS'; el.dispatchEvent(new Event('input', {bubbles: true}));
      document.querySelector('#settings-form').requestSubmit();
    """)
    until(browser, "document.querySelector('#save-status').textContent.includes('salvas neste')")
    browser.navigate(origin)
    until(browser, "document.querySelector('#setting-municipality') !== null")
    assert (
        browser.execute("return document.querySelector('#setting-municipality').value")
        == "Porto Alegre/RS"
    )
    browser.command("POST", "/window/rect", {"width": 390, "height": 844})
    assert browser.execute("return document.documentElement.scrollWidth <= window.innerWidth")


def test_portal_fields_fail_closed_and_never_emit(browser_app):
    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    fields = {f["key"]: f for f in ALL_FIELDS}
    used = []
    assert (
        browser.execute(
            app.automation.script,
            {**fields["competence"], "value": "2026-11-05"},
            "",
            [],
            origin,
            True,
        )["status"]
        == "present"
    )
    assert browser.execute("return document.querySelector('#DataCompetencia').value") == ""

    def fill(key, value, selector=""):
        result = browser.execute(
            app.automation.script, {**fields[key], "value": value}, selector, used, origin
        )
        if result["status"] == "filled":
            used.append(result["target"])
        return result

    for key, value in [
        ("competence", "2026-11-05"),
        ("ibs_cbs", "Sim"),
        ("customer_document", "12ABC34501DE35"),
        ("country", "Brasil"),
        ("municipality", "Alegrete/RS"),
        ("national_tax", "09.01.01"),
        ("cst", "000"),
        ("classification", "000001"),
        ("description", "Hospedagem de <h1>Teste</h1>."),
        ("service_value", "1250,00"),
    ]:
        assert fill(key, value)["status"] == "filled"
    assert fill("municipality", "Alegrete/RS", "#duplicate1, #duplicate2")["status"] == "ambiguous"
    assert fill("municipality", "Alegrete/RS", "#duplicate1")["status"] == "filled"
    assert fill("description", "sobrescrever")["status"] == "duplicate"
    assert fill("nbs", "000", "button")["status"] == "unsupported"
    assert browser.execute("return window.emitted") is False
    assert (
        browser.execute("return document.querySelector('#description').value")
        == "Hospedagem de <h1>Teste</h1>."
    )
    # O mesmo script, sem a origem de fixture explícita, rejeita páginas fora do portal.
    assert (
        browser.execute(app.automation.script, {**fields["cst"], "value": "000"}, "", [])["status"]
        == "wrong_page"
    )


def test_autocomplete_selects_an_option_and_checks_binding(browser_app):
    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    field = next(f for f in ALL_FIELDS if f["key"] == "country") | {"value": "Brasil"}
    field.pop("portal_selector")
    result = browser.execute(app.automation.script, field, "", [], origin)
    assert result["status"] == "search"
    browser.type_text(result["input"], field["value"])
    option = browser.execute(app.automation.options_script, field["value"], "option", None, origin)
    assert option["status"] == "option"
    browser.click(option["option"])
    assert browser.execute("return document.querySelector('#country').dataset.selectedCode") == "BR"
    assert (
        browser.execute(
            app.automation.options_script, field["value"], "verify", result["target"], origin
        )["status"]
        == "filled"
    )


def test_competence_variants_and_inspection_without_entered_values(browser_app):
    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    field = next(f for f in ALL_FIELDS if f["key"] == "competence") | {"value": "2026-11-05"}
    browser.execute("""
      const input = document.querySelector('#DataCompetencia');
      input.name = 'DPS.DataCompetencia';
      const label = input.closest('.form-group').querySelector('label');
      label.htmlFor = input.id; label.textContent = 'Competência *';
    """)
    field.pop("portal_selector")
    assert browser.execute(app.automation.script, field, "", [], origin)["status"] == "filled"
    # Sem label associado, o identificador semântico exato ainda resolve o controle.
    browser.execute("document.querySelector('label[for=DataCompetencia]').remove()")
    assert browser.execute(app.automation.script, field, "", [], origin)["status"] == "filled"
    browser.execute("""
      document.querySelector('#Tomador_Inscricao').value = 'DOCUMENTO-PRIVADO';
      document.querySelector('#description').value = 'NOME-PRIVADO';
    """)
    report = browser.execute(app.automation.inspect_script, origin)
    assert report["status"] == "inspected"
    assert "DOCUMENTO-PRIVADO" not in str(report)
    assert "NOME-PRIVADO" not in str(report)
    assert "2026-11-05" not in str(report)
    assert any(f["selector"] == "#DataCompetencia" for f in report["fields"])


def test_people_with_hidden_radios_duplicate_ids_and_chosen(browser_app, invoice_data):
    from nfse_filler.domain import prepare_invoice

    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    browser.execute("document.querySelector('#DataCompetencia').hidden = true")
    invoice = prepare_invoice(invoice_data, app.store.load())
    used = []
    for field in invoice["steps"][0]["fields"]:
        result = browser.execute(app.automation.script, field, "", used, origin)
        assert result["status"] == "filled", (field["key"], result)
        used.append(result["target"])
    assert (
        browser.execute('return document.querySelector("[name=PreencherInfoIBSCBS]:checked").value')
        == "1"
    )
    assert (
        browser.execute("return document.querySelector('#DataCompetencia').value") == "05/11/2026"
    )
    assert (
        browser.execute(
            "return document.querySelector('#SimplesNacional_RegimeApuracaoTributosSN').value"
        )
        == "1"
    )
    assert (
        browser.execute(
            'return document.querySelector("[name=EhCompraGovernamental]:checked").value'
        )
        == "0"
    )
    assert (
        browser.execute(
            "return document.querySelector(\"[name='Intermediario.LocalDomicilio']:checked\").value"
        )
        == "0"
    )
    assert (
        browser.execute(
            "return document.querySelector(\"[name='Tomador.LocalDomicilio']:checked\").value"
        )
        == "1"
    )
    assert browser.execute("return document.querySelector('#Destinatario_Inscricao').value") == ""
    assert browser.execute("return window.emitted") is False


def test_sequential_service_and_values_wait_for_late_dependent_updates(browser_app, invoice_data):
    from unittest.mock import Mock

    from nfse_filler.domain import prepare_invoice

    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    browser.execute("""
      window.delayServiceReady = true;
      window.jQuery = () => ({trigger() {}});
      window.jQuery.active = 0;
    """)
    session = Mock(wraps=browser)
    session.portal_page.return_value = "/EmissorNacional/DPS/Servico"

    def execute(script, *args):
        supplied = list(args)
        while len(supplied) < 4:
            supplied.append(None)
        supplied[3] = origin
        return browser.execute(script, *supplied)

    session.execute.side_effect = execute
    app.automation.session = session
    invoice = prepare_invoice(invoice_data, app.store.load())
    for _ in range(2):
        app.automation.submit("fill", invoice, "service", {})
        app.automation.worker.join(30)
        assert app.automation.status()["status"] == "done", app.automation.status()
    assert browser.execute("return window.serviceChanges") == {"country": 1, "municipality": 1}
    assert (
        browser.execute("return document.querySelector('#description').value")
        == invoice["description"]
    )
    assert browser.execute("return window.emitted") is False
    session.portal_page.return_value = "/EmissorNacional/DPS/Tributacao"
    app.automation.submit("fill", invoice, "values", {})
    app.automation.worker.join(30)
    assert app.automation.status()["status"] == "done", app.automation.status()
    assert (
        browser.execute("return document.querySelector('#classification').value") == "class000001"
    )
    assert (
        browser.execute(
            "return document.querySelector(\"[name='ServicoPrestado.CodigoIndOp']\").value"
        )
        == "030101"
    )
    assert browser.execute("return window.emitted") is False


def test_values_confirms_locked_answers_and_uses_ibs_codes(browser_app, invoice_data):
    from nfse_filler.domain import prepare_invoice

    browser, origin, app = browser_app
    browser.navigate(origin + "/fixture")
    invoice = prepare_invoice(invoice_data, app.store.load())
    used = []
    for field in invoice["steps"][2]["fields"]:
        result = browser.execute(app.automation.script, field, "", used, origin)
        assert result["status"] == "filled", (field["key"], result)
        used.append(result["target"])
    assert browser.execute("return document.querySelector('#amount').value") == "1250,00"
    assert browser.execute("return document.querySelector('#cst').value") == "cst000"
    assert (
        browser.execute("return document.querySelector('#classification').value") == "class000001"
    )
    assert browser.execute("return document.querySelector('#pis').value") == ""
    assert (
        browser.execute(
            "return document.querySelector(\"[name='ValorTributos.AliquotaSN']\").value"
        )
        == "12,48"
    )
    assert browser.execute("return window.lockedRadioChanges") == 0
    field = next(f for f in invoice["steps"][2]["fields"] if f["key"] == "iss_suspended")
    result = browser.execute(app.automation.script, {**field, "value": "Sim"}, "", [], origin)
    assert result["status"] != "filled"
    assert browser.execute("return window.lockedRadioChanges") == 0
    assert browser.execute("return window.emitted") is False


def test_hotel_dynamic_room_read_and_structure_do_not_export_guest_values(browser_app):
    from nfse_filler.desbravador import defaults, normalize_stay

    browser, origin, app = browser_app
    browser.navigate(origin + "/hotel-fixture")
    selectors = defaults()["selectors"] | {
        "scope": "#stay",
        "room_card": '[data-uh="{room}"]',
        "room": "#hotel-room",
        "guest_name": "#guest",
        "customer_document": "#doc",
        "check_in": "#in",
        "check_out": "#out",
        "lodging_total": "#lodging",
    }
    script = app.desbravador.script
    assert browser.execute(script, "locate", selectors, "02", origin)["status"] == "located"
    result = browser.execute(script, "read", selectors, "02", origin)
    assert normalize_stay(result["data"], "02")["service_value"] == "600,00"
    assert browser.execute(script, "read", selectors, "03", origin)["status"] == "wrong_room"
    report = browser.execute(script, "inspect", selectors, "02", origin)
    assert report["status"] == "inspected"
    assert "Hóspede de Teste" not in str(report)
    assert "52998224725" not in str(report)
    assert "600,00" not in str(report)


def test_lightweb_room_id_is_not_room_number_and_holder_is_not_first_guest(browser_app):
    from nfse_filler.desbravador import defaults, normalize_stay

    browser, origin, app = browser_app
    browser.navigate(origin + "/hotel-lightweb")
    selectors = defaults()["selectors"]
    assert (
        browser.execute(app.desbravador.script, "locate", selectors, "02", origin)["status"]
        == "located"
    )
    result = browser.execute(app.desbravador.script, "read", selectors, "02", origin)
    assert result["status"] == "read"
    data = normalize_stay(result["data"], "02")
    assert data["guest_name"] == "Titular de Teste"
    assert data["customer_document"] == "52998224725"
    assert data["service_value"] == "600,00"
    assert browser.execute("return window.wrongRoomOpened") is False
    assert browser.execute("return window.pmsSaved") is False
