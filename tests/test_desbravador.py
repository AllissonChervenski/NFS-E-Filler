from threading import Event
from unittest.mock import Mock

import pytest

from nfse_filler.desbravador import (
    Desbravador,
    defaults,
    normalize_stay,
    validate_config,
    validate_room,
)
from nfse_filler.domain import ValidationError
from nfse_filler.server import Application


@pytest.fixture
def stay():
    return {
        "room": "02",
        "guest_name": "Hóspede de Teste",
        "customer_document": "529.982.247-25",
        "check_in": "02/11/2026 14:30",
        "check_out": "05/11/2026 10:00",
        "lodging_total": "R$ 600,00",
        "account_total": "900,00",
        "consumption": "300,00",
    }


def configured():
    config = defaults()
    for field in [
        "room",
        "guest_name",
        "customer_document",
        "check_in",
        "check_out",
        "lodging_total",
    ]:
        config["selectors"][field] = f"#{field}"
    return config


def test_import_uses_only_lodging_subtotal_and_formats_dates(stay):
    result = normalize_stay(stay, "2")
    assert result["service_value"] == "600,00"
    assert result["check_in"] == "02/11/2026"
    assert result["check_out"] == "05/11/2026"
    assert result["customer_document"] == "52998224725"
    assert "account_total" not in result


def test_no_fallback_to_account_total_if_lodging_subtotal_missing(stay):
    stay.pop("lodging_total")
    with pytest.raises(ValidationError):
        normalize_stay(stay, "02")


def test_another_room_is_rejected(stay):
    with pytest.raises(ValidationError, match="quarto aberto"):
        normalize_stay(stay, "03")


def test_missing_or_invalid_document_can_be_completed_manually(stay):
    stay["customer_document"] = "Não informado"
    assert normalize_stay(stay, "02")["customer_document"] == ""


@pytest.mark.parametrize("room", [None, "", "  ", "02\n03", "2/3", "X" * 21])
def test_room_input_validation(room):
    with pytest.raises(ValidationError):
        validate_room(room)


@pytest.mark.parametrize(
    "url",
    [
        "https://evil.test/acesso/3672",
        "http://desbravadorweb.com.br/acesso/3672",
        "https://user:secret@desbravadorweb.com.br/acesso/3672",
        "https://desbravadorweb.com.br/logout",
    ],
)
def test_only_hotel_access_urls_are_accepted(url):
    config = defaults()
    config["login_url"] = url
    with pytest.raises(ValidationError):
        validate_config(config)


def test_mapping_persists_without_changing_nfse_settings(tmp_path):
    app = Application(tmp_path)
    original = app.store.load()
    config = configured()
    app.dispatch("POST", "/api/desbravador/config", config)
    restarted = Application(tmp_path)
    assert restarted.desbravador.store.load() == config
    assert restarted.store.load() == original


class HotelSession:
    def __init__(self, profile):
        self.session_id = "test"
        self.stop_event = Event()
        self.execute = Mock()
        self.command = Mock()
        self.start = Mock()
        self.navigate = Mock()


def test_lookup_rejects_unmapped_fields_without_clicking_rooms(tmp_path):
    hotel = Desbravador(tmp_path, HotelSession)
    config = defaults()
    config["selectors"]["guest_name"] = ""
    hotel.store.save(config)
    hotel.select_page = Mock()
    hotel.submit("lookup", "02")
    hotel.worker.join(2)
    assert hotel.status()["status"] == "error"
    assert "Inspecionar" in hotel.status()["message"]
    hotel.session.execute.assert_not_called()


def test_successful_lookup_returns_preview_without_applying_or_persisting_guest(tmp_path, stay):
    hotel = Desbravador(tmp_path, HotelSession)
    hotel.store.save(configured())
    hotel.select_page = Mock()
    hotel.session.execute.side_effect = [{"status": "located"}, {"status": "read", "data": stay}]
    hotel.submit("lookup", "02")
    hotel.worker.join(2)
    assert hotel.status()["status"] == "done"
    assert hotel.status()["result"]["service_value"] == "600,00"
    assert "Hóspede de Teste" not in hotel.store.path.read_text()
    assert not list(tmp_path.glob("*stay*"))


def test_inspector_does_not_require_field_mapping(tmp_path):
    hotel = Desbravador(tmp_path, HotelSession)
    hotel.select_page = Mock()
    hotel.session.execute.return_value = {"status": "inspected", "fields": [{"id": "room"}]}
    hotel.submit("inspect")
    hotel.worker.join(2)
    assert hotel.status()["diagnostics"]["fields"] == [{"id": "room"}]
    assert hotel.status()["result"] is None


def test_manual_invoice_does_not_depend_on_hotel_or_room(tmp_path, invoice_data):
    app = Application(tmp_path)
    app.desbravador.submit = Mock()
    assert app.dispatch("POST", "/api/preview", invoice_data)["amount"] == "1250.00"
    app.desbravador.submit.assert_not_called()


def test_initial_empty_mapping_migrates_without_overwriting_custom_mapping():
    config = defaults()
    config["selectors"] = {
        key: "#conteudo-ajax" if key == "scope" else "" for key in config["selectors"]
    }
    assert validate_config(config) == defaults()
    custom = configured()
    assert validate_config(custom) == custom


def test_tariff_total_label_accepts_one_amount_only(stay):
    stay["lodging_total"] = "Total das diárias R$ 600,00"
    assert normalize_stay(stay, "02")["service_value"] == "600,00"
    stay["lodging_total"] = "Total R$ 600,00 e consumo R$ 100,00"
    with pytest.raises(ValidationError):
        normalize_stay(stay, "02")
