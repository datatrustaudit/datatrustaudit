"""Regressão de SSRF.

A validação anterior (api/scans.py) comparava strings: bloqueava só "localhost"
e "127.0.0.1" no netloc. Destes 18 destinos, 12 passavam — inclusive o endpoint
de metadados da AWS, que devolve credenciais IAM para quem conseguir fazer o
servidor buscá-lo.
"""
import pytest

from audit_engine.url_guard import validate_public_url, is_public_url, UnsafeURLError

DESTINOS_BLOQUEADOS = [
    ("http://169.254.169.254/latest/meta-data/iam/security-credentials/", "credenciais IAM da AWS"),
    ("http://metadata.google.internal/computeMetadata/v1/", "metadados do GCP"),
    ("http://127.1/", "loopback em forma curta"),
    ("http://2130706433/", "loopback em decimal"),
    ("http://0.0.0.0:8000/", "endereço não especificado"),
    ("http://[::1]:8000/", "loopback IPv6"),
    ("http://[::ffff:127.0.0.1]/", "IPv4 mapeado em IPv6"),
    ("http://10.0.0.5/admin", "rede interna 10/8"),
    ("http://192.168.0.1/", "LAN doméstica"),
    ("http://172.17.0.1:5432/", "gateway do Docker"),
    ("http://redis:6379/", "serviço interno por nome"),
    ("http://localhost:8000/", "localhost"),
    ("http://LOCALHOST./", "localhost com ponto final e maiúsculas"),
    ("file:///etc/passwd", "esquema file://"),
    ("gopher://evil/", "esquema gopher://"),
    ("", "string vazia"),
    ("http://127.0.0.1.nip.io/", "DNS coringa apontando para loopback"),
    ("http://localtest.me/", "domínio público que resolve para 127.0.0.1"),
]

DESTINOS_PERMITIDOS = [
    "https://www.google.com/",
    "agencialoi.com",
    "https://example.com/pagina?a=1#frag",
    "http://neverssl.com/",
]


@pytest.mark.parametrize("url,motivo", DESTINOS_BLOQUEADOS, ids=[m for _, m in DESTINOS_BLOQUEADOS])
def test_destino_interno_e_recusado(url, motivo):
    with pytest.raises(UnsafeURLError):
        validate_public_url(url)
    assert is_public_url(url) is False


@pytest.mark.parametrize("url", DESTINOS_PERMITIDOS)
def test_site_publico_passa(url):
    assert validate_public_url(url).startswith(("http://", "https://"))


def test_url_sem_esquema_vira_https():
    # resolve_dns=False: o teste é sobre a normalização do esquema, não sobre a
    # existência do domínio — senão passaria a depender de rede e de DNS.
    assert validate_public_url("exemplo.com.br", resolve_dns=False).startswith("https://")


def test_url_absurdamente_longa_e_recusada():
    with pytest.raises(UnsafeURLError):
        validate_public_url("https://exemplo.com/" + "a" * 3000)
