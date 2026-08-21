"""Grava um vídeo percorrendo o laudo, para demonstração.

    python scripts/gravar_demonstracao.py [url]

Usa o `/dev/laudo`, que abre o laudo completo a partir de uma varredura real
congelada — sem login, sem consumir cota e sem esperar o Chromium a cada
execução. Regenere a amostra antes com `scripts/gerar_amostra_do_laudo.py`
apontando para o site que você quer mostrar.

O plano é liberado no `localStorage` antes do primeiro render: o laudo lê o
plano do contexto, e sem isso a gravação mostraria os cadeados em vez do
conteúdo pago.

Saída em WebM (é o que o Playwright grava). Abre em qualquer navegador e no
VLC; para PowerPoint ou WhatsApp, converta para MP4 com ffmpeg:

    ffmpeg -i demonstracao.webm -c:v libx264 -pix_fmt yuv420p demonstracao.mp4
"""
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "demonstracao"
ENDERECO = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080/dev/laudo"

#: 1280x800 mostra a tabela de parâmetros inteira sem rolagem lateral. Menos que
#: isso e as colunas quebram; mais e o texto fica pequeno demais no vídeo.
JANELA = {"width": 1280, "height": 800}

#: Cada parada: (rótulo da aba, segundos de leitura). O tempo é generoso de
#: propósito — quem assiste precisa ler, não só ver a tela piscar.
ROTEIRO = [
    ("Painel", 4),
    ("Coleta", 9),
    ("Correção", 8),
    ("Eventos", 7),
    ("GTM Quality", 5),
    ("Privacidade", 5),
    ("Timeline", 4),
    ("Resultados", 4),
]


def _rolar_devagar(page, passos=6, pausa=0.45):
    """Rola de a pouco. Um salto até o fim não deixa ler nada."""
    for _ in range(passos):
        page.mouse.wheel(0, 420)
        time.sleep(pausa)


def main() -> int:
    DESTINO.mkdir(exist_ok=True)
    print(f"Gravando {ENDERECO} …")

    with sync_playwright() as p:
        navegador = p.chromium.launch()
        contexto = navegador.new_context(
            viewport=JANELA,
            record_video_dir=str(DESTINO),
            record_video_size=JANELA,
            locale="pt-BR",
        )
        page = contexto.new_page()

        # O plano precisa estar liberado ANTES do primeiro render — depois, o
        # contexto do React já decidiu o que esconder.
        page.add_init_script(
            """localStorage.setItem('gtm-audit-plan', JSON.stringify(
                {type:'premium', name:'Admin', scansRemaining:-1,
                 scansLimit:-1, isAdmin:true, features:[]}));"""
        )

        page.goto(ENDERECO, wait_until="networkidle", timeout=60_000)
        time.sleep(2.5)

        # O seletor precisa ser por TEXTO CONTIDO, não por nome exato: os botões
        # do seletor de leitor e das abas trazem título e descrição no mesmo
        # elemento (titulo e descricao juntos), entao `exact=True` nao casa
        # com nenhum deles.
        # não casa com nenhum deles.
        def _aba(rotulo: str):
            return page.locator("[role=tab]").filter(has_text=rotulo).first

        try:
            _aba("Técnico").click(timeout=8_000)
            time.sleep(1.8)
        except Exception as e:  # noqa: BLE001
            print(f"  aviso: não abri a visão técnica ({type(e).__name__}) — sigo pelo que estiver na tela")

        for aba, segundos in ROTEIRO:
            try:
                _aba(aba).click(timeout=8_000)
            except Exception:  # noqa: BLE001
                print(f"  aba '{aba}' não encontrada — pulando")
                continue
            print(f"  {aba} …")
            time.sleep(1.2)
            _rolar_devagar(page)
            time.sleep(max(0.0, segundos - 4))
            page.mouse.wheel(0, -4000)   # volta ao topo antes da próxima
            time.sleep(0.6)

        contexto.close()   # o vídeo só é finalizado no close
        navegador.close()

    videos = sorted(DESTINO.glob("*.webm"), key=lambda f: f.stat().st_mtime)
    if not videos:
        print("Nenhum vídeo gerado — a gravação falhou.")
        return 1

    v = videos[-1]
    print(f"\nGravado: {v}  ({v.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
