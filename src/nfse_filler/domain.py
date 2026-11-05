"""Campos e validações do roteiro preenchimento.md, sem cálculos fiscais."""

import hashlib
import json
import re
from datetime import date
from decimal import Decimal, InvalidOperation

PORTAL_URL = "https://www.nfse.gov.br/EmissorNacional/DPS/Pessoas"
STEPS = {"people": "Pessoas", "service": "Serviço", "values": "Valores"}


def field(key, label, default, step, aliases, choices=None, hint="", kind="text", identifiers=None):
    return dict(
        key=key,
        label=label,
        default=default,
        step=step,
        aliases=aliases,
        choices=choices,
        hint=hint,
        kind=kind,
        identifiers=identifiers or [],
    )


YES_NO = ["Sim", "Não"]
FIELDS = [
    field(
        "ibs_cbs",
        "Preencher informações IBS/CBS",
        "Sim",
        "people",
        ["Preencher as informações IBS/CBS"],
        YES_NO,
    ),
    field(
        "regime",
        "Regime de apuração",
        "Regime de apuração dos tributos federais e municipal pelo Simples Nacional",
        "people",
        ["Regime de Apuração dos Tributos no Simples Nacional"],
    ),
    field(
        "government", "Compras governamentais", "Não", "people", ["Compras Governamentais"], YES_NO
    ),
    field(
        "same_recipient",
        "Destinatário é o próprio adquirente",
        "Sim",
        "people",
        ["Para fins de apuração do IBS/CBS, o destinatário é o próprio adquirente"],
        YES_NO,
    ),
    field(
        "intermediary",
        "Intermediário",
        "Intermediário não informado",
        "people",
        ["Onde está localizado o estabelecimento/domicílio"],
        hint="Refere-se ao grupo Intermediário do Serviço; ajuste o seletor se houver duplicidade.",
    ),
    field("country", "País da prestação", "Brasil", "service", ["País"]),
    field("municipality", "Município da prestação", "Alegrete/RS", "service", ["Município"]),
    field(
        "national_tax",
        "Código de tributação nacional",
        "09.01.01",
        "service",
        ["Código de Tributação Nacional"],
        hint="Hospedagem em hotéis e congêneres.",
    ),
    field(
        "municipal_tax",
        "Código complementar municipal",
        "090101001",
        "service",
        ["Código Complementar Municipal"],
    ),
    field(
        "iss_non_incidence",
        "Imunidade, exportação ou não incidência do ISSQN",
        "Não",
        "service",
        [
            "O serviço/fornecimento prestado é um caso de: imunidade, exportação de serviço ou não incidência do ISSQN"
        ],
        YES_NO,
    ),
    field(
        "nbs",
        "Item da NBS",
        "103042000",
        "service",
        ["Item da NBS correspondente ao serviço/fornecimento prestado"],
    ),
    field(
        "operation_indicator",
        "Código indicador da operação",
        "030101",
        "service",
        ["Código indicador da operação"],
    ),
    field(
        "iss_suspended",
        "Exigibilidade do ISSQN suspensa",
        "Não",
        "values",
        ["A exigibilidade do recolhimento do ISSQN devido nesta operação está suspensa"],
        YES_NO,
    ),
    field(
        "iss_withheld",
        "Retenção do ISSQN",
        "Não",
        "values",
        ["Há retenção do ISSQN pelo Tomador ou pelo Intermediário"],
        YES_NO,
    ),
    field(
        "municipal_benefit",
        "Benefício municipal",
        "Não",
        "values",
        ["Este serviço prestado está amparado por algum benefício municipal"],
        YES_NO,
    ),
    field(
        "cst",
        "Situação tributária — primeiro código",
        "000",
        "values",
        ["Código de Situação Tributária"],
        hint="CST do grupo Valor dos tributos (IBS/CBS), separado da situação de PIS/COFINS.",
    ),
    field(
        "classification",
        "Situação tributária — segundo código",
        "000001",
        "values",
        ["Código de Situação Tributária"],
        hint="Classificação tributária do grupo Valor dos tributos (IBS/CBS).",
    ),
    field(
        "tax_mode",
        "Valor aproximado dos tributos",
        "Informar alíquota do Simples Nacional",
        "values",
        ["Valor aproximado dos tributos"],
    ),
    field(
        "simple_rate",
        "Alíquota do Simples Nacional (%)",
        "12,48",
        "values",
        ["Alíquota do Simples Nacional", "Alíquota"],
        kind="rate",
    ),
]
VARIABLE_FIELDS = [
    field(
        "competence",
        "Data de competência",
        "",
        "people",
        ["Data de competência", "Data da competência", "Competência", "Data"],
        identifiers=["DataCompetencia", "Competencia"],
    ),
    field("customer_document", "CPF/CNPJ do tomador", "", "people", ["CPF/CNPJ"]),
    field(
        "description",
        "Descrição do serviço",
        "",
        "service",
        ["Descrição do Serviço/Fornecimento", "Descrição do Serviço"],
    ),
    field(
        "service_value",
        "Valor da hospedagem",
        "",
        "values",
        ["Valor da operação/serviço prestado", "Valor do serviço", "Valor do Serviço Prestado"],
    ),
]
ALL_FIELDS = FIELDS + VARIABLE_FIELDS
# Controles observados no HTML da etapa Pessoas. O mapeamento salvo pelo usuário
# continua tendo prioridade; nomes são usados porque os radios repetem o ID.
PEOPLE_SELECTORS = {
    "ibs_cbs": 'input[type="radio"][name="PreencherInfoIBSCBS"]',
    "competence": 'input[name="DataCompetencia"]',
    "regime": 'select[name="SimplesNacional.RegimeApuracaoTributosSN"]',
    "government": 'input[type="radio"][name="EhCompraGovernamental"]',
    "customer_document": 'input[name="Tomador.Inscricao"]',
    "same_recipient": 'input[type="radio"][name="DestinatarioEhOAdquirente"]',
    "intermediary": 'input[type="radio"][name="Intermediario.LocalDomicilio"]',
}
SERVICE_SELECTORS = {
    "country": 'select[name="LocalPrestacao.CodigoPaisPrestacao"]',
    "municipality": 'select[name="LocalPrestacao.CodigoMunicipioPrestacao"]',
    "national_tax": 'select[name="ServicoPrestado.CodigoTributacaoNacional"]',
    "municipal_tax": 'select[name="ServicoPrestado.CodigoComplementarMunicipal"]',
    "iss_non_incidence": 'input[type="radio"][name="ServicoPrestado.HaExportacaoImunidadeNaoIncidencia"]',
    "nbs": 'select[name="ServicoPrestado.CodigoNBS"]',
    "operation_indicator": 'select[name="ServicoPrestado.CodigoIndOp"]',
    "description": 'textarea[name="ServicoPrestado.Descricao"]',
}
VALUE_SELECTORS = {
    "service_value": 'input[name="Valores.ValorServico"]',
    "iss_suspended": 'input[type="radio"][name="ISSQN.HaSuspensao"]',
    "iss_withheld": 'input[type="radio"][name="ISSQN.HaRetencao"]',
    "municipal_benefit": 'input[type="radio"][name="ISSQN.HaBeneficioMunicipal"]',
    "cst": 'select[name="ValorTributos.CodigoSituacaoTributaria"]',
    "classification": 'select[name="ValorTributos.CodigoClassificacaoTributaria"]',
    "tax_mode": 'input[type="radio"][name="ValorTributos.TipoValorTributos"]',
    "simple_rate": 'input[name="ValorTributos.AliquotaSN"]',
}
for _field in ALL_FIELDS:
    _selector = (PEOPLE_SELECTORS | SERVICE_SELECTORS | VALUE_SELECTORS).get(_field["key"])
    if _selector:
        _field["portal_selector"] = _selector
FIELD_KEYS = {f["key"] for f in ALL_FIELDS}
STEP_FIELDS = {
    "people": [
        "ibs_cbs",
        "competence",
        "regime",
        "government",
        "customer_document",
        "same_recipient",
        "intermediary",
    ],
    "service": [f["key"] for f in ALL_FIELDS if f["step"] == "service"],
    "values": ["service_value"] + [f["key"] for f in FIELDS if f["step"] == "values"],
}


class ValidationError(ValueError):
    pass


def settings_signature(settings):
    return hashlib.sha256(json.dumps(settings, sort_keys=True).encode()).hexdigest()


def decimal_value(value, label, *, maximum=None, allow_zero=False):
    text = str(value).strip()
    if len(text) > 24:
        raise ValidationError(f"{label}: valor acima do limite permitido.")
    if "," in text:
        if not re.fullmatch(r"(?:\d+|\d{1,3}(?:\.\d{3})+),\d{1,2}", text):
            raise ValidationError(f"{label}: use o formato 1.250,00.")
        text = text.replace(".", "").replace(",", ".")
    elif not re.fullmatch(r"\d+(?:\.\d{1,2})?", text):
        raise ValidationError(f"{label}: informe um número com até duas casas decimais.")
    try:
        result = Decimal(text)
    except InvalidOperation:
        raise ValidationError(f"{label}: valor inválido.") from None
    if result < 0 or (result == 0 and not allow_zero) or (maximum is not None and result > maximum):
        raise ValidationError(f"{label}: valor fora do intervalo permitido.")
    return result.quantize(Decimal("0.01"))


def normalize_document(value):
    return re.sub(r"[.\-/\s]", "", value).upper()


def valid_document(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9A-Za-z.\-/\s]+", value):
        return False
    document = normalize_document(value)
    if not re.fullmatch(r"(?:[0-9]{11}|[A-Z0-9]{12}[0-9]{2})", document):
        return False
    if len(set(document)) == 1:
        return False
    # Receita Federal: cada caractere do CNPJ contribui com ASCII - 48.
    numbers = [ord(d) - 48 for d in document]
    weights = (
        [list(range(10, 1, -1)), list(range(11, 1, -1))]
        if len(document) == 11
        else [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]
    )
    for offset, weight in enumerate(weights):
        remainder = sum(n * w for n, w in zip(numbers[: len(weight)], weight, strict=True)) % 11
        expected = 0 if remainder < 2 else 11 - remainder
        if numbers[len(numbers) - 2 + offset] != expected:
            return False
    return True


def validate_settings(data):
    if not isinstance(data, dict) or set(data) - {"values", "selectors"}:
        raise ValidationError("Configuração inválida.")
    values, selectors = data.get("values"), data.get("selectors", {})
    if not isinstance(values, dict) or not isinstance(selectors, dict):
        raise ValidationError("Informe os valores e o mapeamento dos campos.")
    if set(values) != {f["key"] for f in FIELDS} or set(selectors) - FIELD_KEYS:
        raise ValidationError("Os campos da configuração não correspondem ao roteiro.")
    for f in FIELDS:
        value = values[f["key"]]
        if not isinstance(value, str) or not value.strip() or len(value) > 1000:
            raise ValidationError(f"{f['label']}: preencha um valor válido.")
        if f["choices"] and value not in f["choices"]:
            raise ValidationError(f"{f['label']}: opção inválida.")
    rate = decimal_value(values["simple_rate"], "Alíquota", maximum=Decimal(100), allow_zero=True)
    for key, selector in selectors.items():
        if not isinstance(selector, str) or len(selector) > 500:
            raise ValidationError(f"Seletor inválido: {key}.")
    normalized_values = {k: v.strip() for k, v in values.items()}
    normalized_values["simple_rate"] = str(rate).replace(".", ",")
    return {
        "values": normalized_values,
        "selectors": {k: v.strip() for k, v in selectors.items() if v.strip()},
    }


def prepare_invoice(data, settings):
    if not isinstance(data, dict):
        raise ValidationError("Dados da hospedagem inválidos.")
    name = data.get("guest_name", "")
    if not isinstance(name, str) or not name.strip() or len(name) > 200:
        raise ValidationError("Informe o nome do hóspede (até 200 caracteres).")
    parsed = {}
    for key, label in [
        ("competence", "Competência"),
        ("check_in", "Check-in"),
        ("check_out", "Check-out"),
    ]:
        try:
            raw = data.get(key, "")
            if not isinstance(raw, str):
                raise ValueError
            if re.fullmatch(r"[0-9]{2}/[0-9]{2}/[0-9]{4}", raw):
                day, month, year = map(int, raw.split("/"))
                parsed[key] = date(year, month, day)
            elif re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", raw):
                parsed[key] = date.fromisoformat(raw)
            else:
                raise ValueError
        except (TypeError, ValueError):
            raise ValidationError(f"{label}: informe uma data válida.") from None
    if parsed["check_out"] <= parsed["check_in"]:
        raise ValidationError("O check-out deve ser posterior ao check-in.")
    if not valid_document(data.get("customer_document", "")):
        raise ValidationError("Informe um CPF ou CNPJ válido para o tomador.")
    amount = decimal_value(data.get("service_value", ""), "Valor da hospedagem")
    if amount > Decimal("999999999999.99"):
        raise ValidationError("Valor da hospedagem acima do limite permitido.")
    description = (
        f"Hospedagem de {name.strip()}. "
        f"Check-in no dia {parsed['check_in']:%d/%m/%Y} "
        f"e Check-out {parsed['check_out']:%d/%m/%Y}"
    )
    values = dict(
        settings["values"],
        competence=parsed["competence"].isoformat(),
        customer_document=normalize_document(data["customer_document"]),
        description=description,
        service_value=str(amount).replace(".", ","),
    )
    by_key = {f["key"]: f for f in ALL_FIELDS}
    steps = [
        {
            "key": key,
            "label": label,
            "fields": [{**by_key[k], "value": values[k]} for k in STEP_FIELDS[key]],
        }
        for key, label in STEPS.items()
    ]
    return {
        "description": description,
        "amount": str(amount),
        "steps": steps,
        "settings_signature": settings_signature(settings),
    }
