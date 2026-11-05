import pytest

from nfse_filler.storage import SettingsStore


@pytest.fixture
def settings(tmp_path):
    return SettingsStore(tmp_path / "data").load()


@pytest.fixture
def invoice_data():
    # Documentos de teste; não representam uma hospedagem real.
    return {
        "guest_name": "Hóspede de Teste",
        "customer_document": "529.982.247-25",
        "competence": "2026-11-05",
        "check_in": "2026-11-02",
        "check_out": "2026-11-05",
        "service_value": "1.250,00",
    }
