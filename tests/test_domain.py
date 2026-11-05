from decimal import Decimal

import pytest

from nfse_filler.domain import (
    ValidationError,
    decimal_value,
    prepare_invoice,
    valid_document,
    validate_settings,
)


def test_invoice_follows_itinerary_with_defaults(invoice_data, settings):
    result = prepare_invoice(invoice_data, settings)
    assert result["description"] == (
        "Hospedagem de Hóspede de Teste. Check-in no dia 02/11/2026 e Check-out 05/11/2026"
    )
    assert result["amount"] == "1250.00"
    by_step = {s["key"]: s["fields"] for s in result["steps"]}
    assert [f["key"] for f in by_step["people"]][:2] == ["ibs_cbs", "competence"]
    assert by_step["values"][0]["value"] == "1250,00"
    fields = {f["key"]: f["value"] for s in result["steps"] for f in s["fields"]}
    assert fields["customer_document"] == "52998224725"
    assert fields["national_tax"] == "09.01.01"
    assert fields["municipality"] == "Alegrete/RS"
    assert fields["municipal_tax"] == "090101001"
    assert fields["nbs"] == "103042000"
    assert fields["operation_indicator"] == "030101"
    assert fields["cst"] == "000"
    assert fields["classification"] == "000001"
    assert fields["simple_rate"] == "12,48"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("1.250,00", "1250.00"),
        ("1250,5", "1250.50"),
        ("1250.50", "1250.50"),
        ("10", "10.00"),
        ("0,01", "0.01"),
    ],
)
def test_money_is_decimal_and_accepts_brazilian_input(raw, expected):
    assert decimal_value(raw, "Valor") == Decimal(expected)


@pytest.mark.parametrize(
    "raw", ["0", "-1", "NaN", "Infinity", "1,234", "12.34,56", "1.250", "", None]
)
def test_invalid_money_is_rejected(raw):
    with pytest.raises(ValidationError):
        decimal_value(raw, "Valor")


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("check_out", "2026-11-01"),
        ("check_out", "2026-11-02"),
        ("check_in", "2026-02-30"),
        ("check_in", "20261102"),
        ("competence", ""),
        ("guest_name", "  "),
        ("guest_name", ["x"]),
        ("service_value", "1000000000000"),
        ("customer_document", "11111111111"),
        ("customer_document", "52998224724"),
    ],
)
def test_invalid_invoice_cannot_be_prepared(key, value, invoice_data, settings):
    invoice_data[key] = value
    with pytest.raises(ValidationError):
        prepare_invoice(invoice_data, settings)


@pytest.mark.parametrize("document", ["52998224725", "529.982.247-25", "11.222.333/0001-81"])
def test_document_check_digits(document):
    assert valid_document(document)


def test_unknown_settings_and_invalid_selectors_are_rejected(settings):
    settings["selectors"]["not_a_field"] = "#foo"
    with pytest.raises(ValidationError):
        validate_settings(settings)
    settings["selectors"] = {"cst": None}
    with pytest.raises(ValidationError):
        validate_settings(settings)


@pytest.mark.parametrize("rate", ["0", "12,48", "100"])
def test_valid_rate_range(settings, rate):
    settings["values"]["simple_rate"] = rate
    validate_settings(settings)


def test_rate_above_100_is_rejected(settings):
    settings["values"]["simple_rate"] = "100,01"
    with pytest.raises(ValidationError):
        validate_settings(settings)


def test_alphanumeric_cnpj_preserves_letters(invoice_data, settings):
    # Exemplo publicado no Manual de Cálculo do DV da Receita Federal.
    invoice_data["customer_document"] = "12.abc.345/01de-35"
    assert valid_document(invoice_data["customer_document"])
    invoice = prepare_invoice(invoice_data, settings)
    document = next(f for f in invoice["steps"][0]["fields"] if f["key"] == "customer_document")
    assert document["value"] == "12ABC34501DE35"
    assert not valid_document("12.ABC.345/01DE-36")
    assert not valid_document("ABCDE123456")


def test_excessive_money_input_is_validation_error():
    with pytest.raises(ValidationError):
        decimal_value("9" * 100, "Valor")


def test_rate_is_normalized_for_brazilian_portal(settings):
    settings["values"]["simple_rate"] = "12.48"
    assert validate_settings(settings)["values"]["simple_rate"] == "12,48"


def test_brazilian_dates_keep_day_and_month_order(invoice_data, settings):
    invoice_data.update(check_in="31/03/2026", check_out="02/04/2026")
    result = prepare_invoice(invoice_data, settings)
    assert "31/03/2026" in result["description"]
    assert "02/04/2026" in result["description"]


@pytest.mark.parametrize("value", ["31/02/2026", "11/31/2026", "2/11/2026", "05/11/26"])
def test_invalid_brazilian_dates_are_rejected(invoice_data, settings, value):
    invoice_data["check_in"] = value
    with pytest.raises(ValidationError, match="Check-in"):
        prepare_invoice(invoice_data, settings)


def test_brazilian_leap_day_is_valid(invoice_data, settings):
    invoice_data.update(check_in="29/02/2024", check_out="01/03/2024")
    assert "29/02/2024" in prepare_invoice(invoice_data, settings)["description"]
