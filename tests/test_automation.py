import threading
from unittest.mock import Mock

import pytest

from nfse_filler.browser import Automation, BrowserCommandError, BrowserError, ChromeSession
from nfse_filler.domain import prepare_invoice


@pytest.fixture(autouse=True)
def fast_field_validation(monkeypatch):
    monkeypatch.setattr("nfse_filler.browser.FIELD_DELAY", 0)
    monkeypatch.setattr("nfse_filler.browser.STABLE_FOR", 0)


class FakeSession:
    def __init__(self, profile):
        self.portal_page = Mock()
        self.calls = []
        self.failure = None

    def execute(self, script, field, selector, used, *extra):
        if extra and extra[-1] == "verify":
            return {"status": "confirmed", "target": field["key"]}
        if extra and extra[-1] is True:
            return {"status": "present"}
        self.calls.append(field["key"])
        if field["key"] == self.failure:
            return {"status": "ambiguous"}
        return {"status": "filled", "target": field["key"]}


def test_fills_one_stage_and_never_navigates_or_emits(tmp_path, settings, invoice_data):
    automation = Automation(tmp_path, FakeSession)
    automation.submit("fill", prepare_invoice(invoice_data, settings), "service", {})
    automation.worker.join(2)
    assert automation.status()["status"] == "done"
    assert not automation.status()["busy"]
    assert "description" in automation.session.calls
    assert "service_value" not in automation.session.calls
    assert automation.session.portal_page.call_count == 1


def test_stops_on_ambiguous_field_and_reports_partial_progress(tmp_path, settings, invoice_data):
    automation = Automation(tmp_path, FakeSession)
    automation.session.failure = "municipality"
    automation.submit("fill", prepare_invoice(invoice_data, settings), "service", {})
    automation.worker.join(2)
    status = automation.status()
    assert status["status"] == "error"
    assert status["failed_field"] == "municipality"
    assert status["completed"] == ["País da prestação"]
    assert automation.session.calls == ["country", "municipality"]


def test_cannot_launch_overlapping_browser_operations(tmp_path):
    automation = Automation(tmp_path, FakeSession)
    automation.update(busy=True)
    with pytest.raises(BrowserError, match="Aguarde"):
        automation.submit("open")


@pytest.mark.parametrize(
    "url",
    [
        "https://www.nfse.gov.br/EmissorNacional/Login",
        "https://evil.test/EmissorNacional/DPS/Pessoas",
        "http://www.nfse.gov.br/EmissorNacional/DPS/Pessoas",
    ],
)
def test_browser_never_fills_login_or_another_origin(tmp_path, url):
    session = ChromeSession(tmp_path)
    session.command = Mock(side_effect=[["window1"], None, url])
    with pytest.raises(BrowserError, match="Emissão Completa"):
        session.portal_page()


def test_failed_open_releases_busy_state(tmp_path):
    automation = Automation(tmp_path, FakeSession)
    automation.session.start = Mock(side_effect=BrowserError("not installed"))
    automation.submit("open")
    automation.worker.join(2)
    assert not automation.status()["busy"]
    assert automation.status()["message"] == "not installed"
    assert not any(t is automation.worker for t in threading.enumerate())


def test_wrong_stage_stops_before_any_field_is_changed(tmp_path, settings, invoice_data):
    automation = Automation(tmp_path, FakeSession)
    automation.session.execute = Mock(return_value={"status": "missing"})
    automation.submit("fill", prepare_invoice(invoice_data, settings), "service", {})
    automation.worker.join(2)
    assert automation.status()["status"] == "error"
    assert "Nenhum campo foi alterado" in automation.status()["message"]
    assert automation.status()["completed"] == []
    assert automation.session.execute.call_count == 1


@pytest.mark.parametrize("verification", ["filled", "rejected"])
def test_autocomplete_reports_verified_result(tmp_path, verification):
    automation = Automation(tmp_path, FakeSession)
    automation.session.click = Mock()
    automation.session.type_text = Mock()
    automation.session.execute = Mock(
        side_effect=[
            {"status": "option", "option": "option-ref"},
            {"status": verification},
        ]
    )
    result = automation._search_option(
        {"value": "Brasil"}, {"input": "input-ref", "target": "country"}
    )
    automation.session.type_text.assert_called_once_with("input-ref", "Brasil")
    automation.session.click.assert_called_once_with("option-ref")
    assert result == {"status": verification, "target": "country"}


def test_people_route_does_not_require_competence_before_ibs_choice(
    tmp_path, settings, invoice_data
):
    automation = Automation(tmp_path, FakeSession)
    automation.session.portal_page.return_value = "/EmissorNacional/DPS/Pessoas"
    original = automation.session.execute

    def execute(script, field, selector, used, *extra):
        if extra and extra[-1] == "verify":
            return original(script, field, selector, used, *extra)
        if extra:
            pytest.fail("A data não deve ser exigida antes da escolha IBS/CBS na rota Pessoas")
        if field["key"] == "competence":
            assert "ibs_cbs" in automation.session.calls
        return original(script, field, selector, used)

    automation.session.execute = execute
    automation.submit("fill", prepare_invoice(invoice_data, settings), "people", {})
    automation.worker.join(2)
    assert automation.status()["status"] == "done"
    assert automation.session.calls[:2] == ["ibs_cbs", "competence"]


def test_portal_page_returns_selected_route(tmp_path):
    session = ChromeSession(tmp_path)
    session.command = Mock(
        side_effect=[
            ["portal"],
            None,
            "https://www.nfse.gov.br/EmissorNacional/DPS/Pessoas",
            None,
        ]
    )
    assert session.portal_page() == "/EmissorNacional/DPS/Pessoas"


def test_inspection_is_read_only_and_available_without_invoice(tmp_path):
    automation = Automation(tmp_path, FakeSession)
    report = {
        "status": "inspected",
        "path": "/EmissorNacional/DPS/Pessoas",
        "fields": [
            {"id": "DataCompetencia", "labels": ["Competência"], "selector": "#DataCompetencia"},
        ],
    }
    automation.session.execute = Mock(return_value=report)
    automation.submit("inspect")
    automation.worker.join(2)
    assert automation.status()["status"] == "done"
    assert automation.status()["diagnostics"] == report
    automation.session.execute.assert_called_once_with(automation.inspect_script)
    assert automation.session.calls == []


def test_service_route_waits_for_national_tax_after_location(
    tmp_path, settings, invoice_data, monkeypatch
):
    automation = Automation(tmp_path, FakeSession)
    automation.session.portal_page.return_value = "/EmissorNacional/DPS/Servico"
    original = automation.session.execute
    pending = {"national_tax", "description"}
    monkeypatch.setattr("nfse_filler.browser.time.sleep", lambda _: None)

    def execute(script, field, selector, used, *extra):
        if extra and extra[-1] == "verify":
            return original(script, field, selector, used, *extra)
        assert not extra, "Não deve exigir tributação habilitada antes do país e município"
        if field["key"] in pending:
            assert automation.session.calls[:2] == ["country", "municipality"]
            pending.remove(field["key"])
            return {"status": "not_ready"}
        return original(script, field, selector, used)

    automation.session.execute = execute
    automation.submit("fill", prepare_invoice(invoice_data, settings), "service", {})
    automation.worker.join(2)
    assert automation.status()["status"] == "done"
    assert pending == set()
    assert automation.session.calls[-1] == "description"


def test_municipality_waits_for_search_and_queries_city_without_losing_state(tmp_path, monkeypatch):
    automation = Automation(tmp_path, FakeSession)
    automation.session.click = Mock()
    automation.session.type_text = Mock()
    automation.session.execute = Mock(
        side_effect=[
            {"status": "missing"},
            {"status": "input", "input": "search-ref"},
            {"status": "option_missing"},
            {"status": "option", "option": "alegrete-rs"},
            {"status": "filled"},
        ]
    )
    monkeypatch.setattr("nfse_filler.browser.time.sleep", lambda _: None)
    result = automation._search_option(
        {"key": "municipality", "value": "Alegrete/RS"}, {"opener": "dropdown", "target": "city"}
    )
    assert result["status"] == "filled"
    automation.session.type_text.assert_called_once_with("search-ref", "Alegrete")
    assert [call.args[0] for call in automation.session.click.call_args_list] == [
        "dropdown",
        "alegrete-rs",
    ]
    for call in automation.session.execute.call_args_list:
        assert call.args[1] == "Alegrete/RS"
        assert call.args[-1] == "municipality"


def test_values_uses_confirmed_tributacao_route(tmp_path, settings, invoice_data):
    automation = Automation(tmp_path, FakeSession)
    automation.session.portal_page.return_value = "/EmissorNacional/DPS/Tributacao"
    automation.submit("fill", prepare_invoice(invoice_data, settings), "values", {})
    automation.worker.join(2)
    assert automation.status()["status"] == "done"
    assert automation.session.calls[0] == "service_value"
    assert automation.session.calls[-2:] == ["tax_mode", "simple_rate"]


def test_retry_does_not_close_an_already_open_search(tmp_path):
    automation = Automation(tmp_path, FakeSession)
    automation.session.click = Mock()
    automation.session.type_text = Mock()
    automation.session.execute = Mock(
        side_effect=[
            {"status": "input", "input": "search"},
            {"status": "option", "option": "result"},
            {"status": "filled"},
        ]
    )
    response = automation._search_option(
        {"key": "municipality", "value": "Alegrete/RS"}, {"opener": "dropdown", "target": "city"}
    )
    assert response["status"] == "filled"
    automation.session.click.assert_called_once_with("result")


class TestClock:
    __test__ = False

    def __init__(self):
        self.value = 0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


def test_field_retries_reset_value_and_confirms_stability(tmp_path, monkeypatch):
    clock = TestClock()
    monkeypatch.setattr("nfse_filler.browser.time", clock)
    monkeypatch.setattr("nfse_filler.browser.FIELD_DELAY", 0.6)
    monkeypatch.setattr("nfse_filler.browser.STABLE_FOR", 0.6)
    automation = Automation(tmp_path, FakeSession)
    writes = []
    checks = iter(
        ["confirmed", "not_ready", "rejected", "confirmed", "confirmed", "confirmed", "confirmed"]
    )

    def execute(script, field, selector, used, *extra):
        if extra:
            return {"status": next(checks), "target": "classification"}
        writes.append(clock.value)
        return {"status": "filled", "target": "classification"}

    automation.session.execute = execute
    result = automation._fill_field(
        {"key": "classification", "label": "Classificação", "value": "000001"}, "", []
    )
    assert result == {"status": "filled", "target": "classification"}
    assert len(writes) == 2
    assert writes[1] >= 0.6
    assert clock.value - writes[1] >= 1.2


def test_transient_error_relocates_control_instead_of_aborting(tmp_path, monkeypatch):
    monkeypatch.setattr("nfse_filler.browser.time", TestClock())
    automation = Automation(tmp_path, FakeSession)
    automation.session.execute = Mock(
        side_effect=[
            BrowserCommandError("stale element reference"),
            {"status": "filled", "target": "new-control"},
            {"status": "confirmed", "target": "new-control"},
        ]
    )
    result = automation._fill_field(
        {"key": "operation_indicator", "label": "Indicador", "value": "030101"}, "#control", []
    )
    assert result["status"] == "filled"
    assert automation.session.execute.call_count == 3


def test_unstable_field_never_advances_to_next_field(tmp_path, settings, invoice_data, monkeypatch):
    monkeypatch.setattr("nfse_filler.browser.time", TestClock())
    monkeypatch.setattr("nfse_filler.browser.FIELD_TIMEOUT", 1)
    automation = Automation(tmp_path, FakeSession)
    automation.session.portal_page.return_value = "/EmissorNacional/DPS/Servico"
    calls = []

    def execute(script, field, selector, used, *extra):
        calls.append(field["key"])
        return {"status": "rejected" if extra else "filled", "target": "country"}

    automation.session.execute = execute
    automation._run("fill", prepare_invoice(invoice_data, settings), "service", {})
    assert automation.status()["status"] == "error"
    assert automation.status()["completed"] == []
    assert set(calls) == {"country"}
    assert "País da prestação" in automation.status()["message"]


def test_fatal_window_error_is_not_retried(tmp_path):
    automation = Automation(tmp_path, FakeSession)
    automation.session.execute = Mock(side_effect=BrowserCommandError("no such window"))
    with pytest.raises(BrowserCommandError, match="janela"):
        automation._fill_field({"key": "cst", "label": "CST"}, "", [])
    assert automation.session.execute.call_count == 1
