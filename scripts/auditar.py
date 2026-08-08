"""Audita um site pelo terminal e imprime o laudo — sem subir a aplicação.

    python scripts/auditar.py https://www.exemplo.com.br
    python scripts/auditar.py https://www.exemplo.com.br --recusa

Com --recusa, além de medir a página como ela carrega, clica em "Recusar" no
banner de consentimento e mede de novo. O que aparecer depois disso é
rastreamento com o consentimento negado.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A aplicação exige SECRET_KEY para subir; a auditoria pelo terminal não usa
# autenticação, então um valor local basta para o import não falhar.
os.environ.setdefault("SECRET_KEY", "auditoria-local-sem-autenticacao-" + "x" * 20)

from audit_engine.browser_fetcher import browser_scan
from audit_engine.orchestrator import run_audit


LARGURA = 74


def titulo(texto: str) -> None:
    print()
    print("=" * LARGURA)
    print(f"  {texto}")
    print("=" * LARGURA)


def secao(texto: str) -> None:
    print()
    print(f"── {texto} " + "─" * max(0, LARGURA - len(texto) - 4))


def paragrafo(texto: str, recuo: int = 6) -> None:
    """Imprime quebrando por palavra.

    Cortar por número de caracteres parte a palavra ao meio ("por|ém",
    "duran|te") — num laudo que vai para o cliente isso passa impressão de
    ferramenta malfeita.
    """
    if not texto:
        return
    largura = max(20, LARGURA - recuo)
    espacos = " " * recuo
    linha = ""
    for palavra in texto.split():
        if not linha:
            linha = palavra
        elif len(linha) + 1 + len(palavra) <= largura:
            linha += " " + palavra
        else:
            print(f"{espacos}{linha}")
            linha = palavra
    if linha:
        print(f"{espacos}{linha}")


def imprimir_guia(guia: dict) -> None:
    """Mostra o passo a passo de correção do achado.

    É o que separa um laudo útil de uma lista de reclamações: quem recebe
    precisa saber o que digitar, não só o que está errado.
    """
    if not guia:
        return

    if guia.get("whyItMatters"):
        print()
        print("      POR QUE IMPORTA")
        paragrafo(guia["whyItMatters"], recuo=8)

    passos = guia.get("howToFix") or []
    if passos:
        print()
        print("      COMO CORRIGIR")
        for i, passo in enumerate(passos, start=1):
            primeira = True
            for linha in _quebrar(passo, LARGURA - 11):
                prefixo = f"       {i}. " if primeira else "          "
                print(f"{prefixo}{linha}")
                primeira = False

    if guia.get("codeExample"):
        print()
        print("      EXEMPLO")
        for linha in guia["codeExample"].split("\n"):
            print(f"        {linha}")

    if guia.get("howToVerify"):
        print()
        print("      COMO CONFERIR SE RESOLVEU")
        paragrafo(guia["howToVerify"], recuo=8)

    rodape = []
    if guia.get("legalBasis"):
        rodape.append(guia["legalBasis"])
    if guia.get("effort"):
        rodape.append(f"esforço: {guia['effort']}")
    if guia.get("ownedBy"):
        rodape.append(f"quem resolve: {guia['ownedBy']}")
    if rodape:
        print()
        paragrafo(" | ".join(rodape), recuo=6)
    print()


def _quebrar(texto: str, largura: int):
    """Quebra por palavra, devolvendo as linhas."""
    linhas, linha = [], ""
    for palavra in texto.split():
        if not linha:
            linha = palavra
        elif len(linha) + 1 + len(palavra) <= largura:
            linha += " " + palavra
        else:
            linhas.append(linha)
            linha = palavra
    if linha:
        linhas.append(linha)
    return linhas


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 1

    url = sys.argv[1]
    testar_recusa = "--recusa" in sys.argv

    titulo(url)
    print("  Varredura em andamento — o scanner nunca clica em 'aceitar'.")

    scan = browser_scan(url, timeout_ms=35000, testar_recusa=testar_recusa)

    if getattr(scan, "fallback_used", False):
        print()
        print("  [ATENÇÃO] O navegador não pôde ser usado — leitura estática do HTML.")
        print("            Sem cookies, sem ordem de disparo e sem teste de recusa.")
        if getattr(scan, "error", None):
            print(f"            Motivo: {scan.error}")

    resultado = run_audit(url, scan)
    privacidade = resultado.privacy
    armazenamento = resultado.storage

    secao("Resumo")
    print(f"  Score de conformidade....: {resultado.scores.overall if resultado.scores else '?'}/100")
    print(f"  Tags de rastreamento.....: {len(resultado.tags)}")
    print(f"  Violações................: {privacidade.total_violations if privacidade else 0}")

    # "sim" aqui contradizia a violação de CMP sem controle exibido logo abaixo.
    cmp_sem_ui = bool(armazenamento) and any(
        a.get("check") == "cmp_present_no_ui" for a in (armazenamento.achados_da_recusa or [])
    )
    if cmp_sem_ui:
        situacao_consentimento = "instalada, mas SEM CONTROLE EXIBIDO"
    elif privacidade and privacidade.has_consent_tool:
        situacao_consentimento = "sim"
    else:
        situacao_consentimento = "NAO"
    print(f"  Ferramenta de consentimento: {situacao_consentimento}")

    if privacidade and privacidade.estimated_risk_exposure:
        print(f"  Exposição estimada.......: {privacidade.estimated_risk_exposure}")

    secao("Tags detectadas")
    if not resultado.tags:
        print("  nenhuma")
    for tag in resultado.tags:
        marca = "  <-- SEM CONSENTIMENTO" if tag.is_before_consent else ""
        identificador = f" [{tag.tag_id}]" if tag.tag_id else ""
        print(f"  • {tag.name}{identificador}{marca}")

    if armazenamento:
        secao("Cookies gravados sem consentimento")
        if not armazenamento.cookies_sem_consentimento:
            print("  nenhum")
        for cookie in armazenamento.cookies_sem_consentimento:
            duracao = f"{cookie.duracao_dias:.0f} dias" if cookie.duracao_dias else "sessão"
            print(f"  • {cookie.nome:<22} {cookie.dono:<24} {duracao}")

        if armazenamento.storage_sem_consentimento:
            secao("Armazenamento local sem consentimento")
            for item in armazenamento.storage_sem_consentimento:
                print(f"  • {item.tipo}: {item.nome} ({item.dono})")

        if armazenamento.linha_do_tempo:
            secao("Ordem real de disparo")
            for evento in armazenamento.linha_do_tempo[:12]:
                print(f"  {evento.ordem:>2}. +{evento.ms_desde_o_inicio:>5} ms  {evento.dono}")

        if armazenamento.problemas_de_ordem:
            secao("Problemas de ordem de carregamento")
            for problema in armazenamento.problemas_de_ordem:
                print(f"  [{problema['status']}] {problema['label']}")
                paragrafo(problema["description"])

        if armazenamento.achados_da_recusa:
            secao("Teste do botão 'Recusar'")
            for achado in armazenamento.achados_da_recusa:
                marcador = "OK " if achado["status"] == "ok" else "!! "
                print(f"  {marcador}[{achado['status']}] {achado['label']}")
                paragrafo(achado["description"])
                imprimir_guia(achado.get("guide"))
        elif testar_recusa:
            secao("Teste do botão 'Recusar'")
            print("  não executado (o navegador não pôde ser usado)")

    if privacidade and privacidade.violations:
        secao("Violações")
        for violacao in privacidade.violations:
            print(f"  [{violacao.severity}] {violacao.tag}")
            paragrafo(violacao.violation)
            print()

    print()
    print("  Aviso: avaliação técnica indicativa. Não constitui parecer jurídico.")
    print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
