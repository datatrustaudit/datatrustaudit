"""audit_engine.url_guard — validação anti-SSRF das URLs de destino.

Fonte única de verdade para "esta URL pode ser auditada?". Antes existiam três
implementações divergentes: api/scans.py comparava strings ("localhost" e
"127.0.0.1", contornável por 127.1, [::1], 169.254.169.254, 10.x, redis:6379…),
api/audit.py validava só quando o host já era um IP literal (todo nome DNS
passava), e /analyze e /deep-analyze no main.py não validavam nada.

O alvo real do ataque é o endpoint de metadados da nuvem
(169.254.169.254 na AWS/GCP/Azure), que devolve credenciais IAM para quem
conseguir fazer o servidor buscar aquela URL.

Limitação conhecida (documentada de propósito): entre a checagem de DNS e a
conexão existe uma janela de TOCTOU — um domínio pode responder um IP público
na validação e um IP interno na conexão (DNS rebinding). Por isso o scanner
Playwright revalida cada request em audit_engine/scanner.py: é lá que a
verificação acontece no momento da conexão, inclusive nos redirects.
"""
import ipaddress
import socket
import time
from typing import Iterable
from urllib.parse import urlparse

MAX_URL_LENGTH = 2048

# Cache de resolução por hostname. O interceptador do Playwright chama isto uma
# vez por request da página (centenas, numa página com muitas tags): sem cache,
# seria um getaddrinfo por recurso carregado.
# TTL curto de propósito — cache longo é o que transforma DNS rebinding em
# janela de ataque.
_DNS_CACHE_TTL_SECONDS = 30
_dns_cache: dict = {}

ALLOWED_SCHEMES = {"http", "https"}

BLOCKED_HOSTNAMES = {
    "localhost",
    "localhost.localdomain",
    "ip6-localhost",
    "ip6-loopback",
    # endpoints de metadados das nuvens (resolvem para 169.254.169.254)
    "metadata.google.internal",
    "metadata.goog",
    "instance-data",
}


class UnsafeURLError(ValueError):
    """URL rejeitada por apontar para destino não público ou malformado."""


def _ip_is_public(ip: ipaddress._BaseAddress) -> bool:
    """False para qualquer faixa que não seja internet pública roteável."""
    if (
        ip.is_private            # 10/8, 172.16/12, 192.168/16, fc00::/7
        or ip.is_loopback        # 127/8, ::1
        or ip.is_link_local      # 169.254/16 (metadados), fe80::/10
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified     # 0.0.0.0, ::
    ):
        return False
    # IPv6 que encapsula IPv4 (::ffff:127.0.0.1, 64:ff9b::/96) — checa o IPv4 interno
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:
        return _ip_is_public(mapped)
    sixtofour = getattr(ip, "sixtofour", None)
    if sixtofour is not None:
        return _ip_is_public(sixtofour)
    return True


def resolve_host_ips(hostname: str) -> list:
    """Todos os IPs (v4 e v6) que o hostname resolve. Levanta UnsafeURLError se não resolver."""
    agora = time.monotonic()
    em_cache = _dns_cache.get(hostname)
    if em_cache is not None:
        expira_em, ips = em_cache
        if expira_em > agora:
            return ips
        del _dns_cache[hostname]

    try:
        infos = socket.getaddrinfo(hostname, None, proto=socket.IPPROTO_TCP)
    except (socket.gaierror, UnicodeError) as exc:
        raise UnsafeURLError(f"Não foi possível resolver o domínio: {hostname}") from exc

    ips = []
    for info in infos:
        try:
            ips.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    if not ips:
        raise UnsafeURLError(f"Não foi possível resolver o domínio: {hostname}")

    if len(_dns_cache) > 1000:  # teto simples contra crescimento sem fim
        _dns_cache.clear()
    _dns_cache[hostname] = (agora + _DNS_CACHE_TTL_SECONDS, ips)
    return ips


def ips_are_public(ips: Iterable) -> bool:
    """True apenas se TODOS os IPs forem públicos — um único interno reprova."""
    ips = list(ips)
    return bool(ips) and all(_ip_is_public(ip) for ip in ips)


def validate_public_url(raw_url: str, *, resolve_dns: bool = True) -> str:
    """Normaliza e valida a URL. Devolve a URL normalizada ou levanta UnsafeURLError.

    resolve_dns=False pula a consulta DNS (útil em teste e em caminhos onde a
    resolução já foi feita); a validação de IP literal continua valendo.
    """
    value = (raw_url or "").strip()
    if not value:
        raise UnsafeURLError("URL não fornecida.")
    if len(value) > MAX_URL_LENGTH:
        raise UnsafeURLError("URL longa demais.")

    if "://" not in value:
        value = f"https://{value}"

    parsed = urlparse(value)

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        raise UnsafeURLError("Somente URLs http:// e https:// podem ser auditadas.")

    hostname = (parsed.hostname or "").strip().rstrip(".").lower()
    if not hostname:
        raise UnsafeURLError("URL inválida. Exemplo: exemplo.com.br")

    if hostname in BLOCKED_HOSTNAMES:
        raise UnsafeURLError("Este destino não pode ser auditado.")

    # IP literal: valida direto, sem DNS (pega 127.1, 2130706433, [::1], 169.254.169.254)
    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        if not _ip_is_public(ip):
            raise UnsafeURLError("Este destino não pode ser auditado.")
        return value

    # Nome DNS: exige domínio qualificado — corta hosts internos do Docker/K8s (redis, db, api)
    if "." not in hostname:
        raise UnsafeURLError("Informe um domínio válido. Exemplo: exemplo.com.br")

    if resolve_dns and not ips_are_public(resolve_host_ips(hostname)):
        raise UnsafeURLError("Este destino não pode ser auditado.")

    return value


def is_public_url(raw_url: str, *, resolve_dns: bool = True) -> bool:
    """Versão booleana, para uso em hot path (ex.: interceptação de requests)."""
    try:
        validate_public_url(raw_url, resolve_dns=resolve_dns)
        return True
    except UnsafeURLError:
        return False
