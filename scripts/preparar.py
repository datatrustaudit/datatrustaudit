"""Prepara o ambiente e sobe a aplicacao. Chamado pelo iniciar.bat.

O .bat faz o minimo (achar o Python e criar o venv) e delega o resto para ca:
arquivo .bat e sensivel a encoding e a caracteres especiais — a primeira versao
deste fluxo quebrou porque o cmd le o arquivo com a codepage do sistema antes
de processar o chcp, e os acentos dos comentarios desbalancearam as aspas.
Em Python nada disso acontece.

Uso:
    python scripts/preparar.py            prepara tudo e sobe a aplicacao
    python scripts/preparar.py --apenas-preparar
"""
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
VENV = RAIZ / ".venv"
PYTHON_VENV = VENV / "Scripts" / "python.exe" if os.name == "nt" else VENV / "bin" / "python"
MARCADOR_DEPS = VENV / ".dependencias-ok"
PORTA = 8000

LARGURA = 60


def cabecalho(texto):
    print()
    print("=" * LARGURA)
    print(f"  {texto}")
    print("=" * LARGURA)
    print()


def passo(numero, total, texto):
    print(f"[{numero}/{total}] {texto}")


def erro(titulo, *linhas):
    print()
    print("!" * LARGURA)
    print(f"  ERRO: {titulo}")
    for linha in linhas:
        print(f"  {linha}")
    print("!" * LARGURA)
    print()


def roda(comando, silencioso=True):
    """Executa e devolve True se deu certo."""
    try:
        resultado = subprocess.run(
            comando,
            cwd=str(RAIZ),
            stdout=subprocess.DEVNULL if silencioso else None,
            stderr=subprocess.STDOUT if silencioso else None,
        )
        return resultado.returncode == 0
    except Exception:
        return False


def instalar_dependencias():
    if MARCADOR_DEPS.exists():
        passo(1, 4, "Dependencias ja instaladas.")
        return True

    passo(1, 4, "Instalando dependencias... (demora na primeira vez)")
    roda([str(PYTHON_VENV), "-m", "pip", "install", "--upgrade", "pip", "--quiet"])
    if not roda([str(PYTHON_VENV), "-m", "pip", "install", "-r", "requirements.txt", "--quiet"], silencioso=False):
        erro("Falha ao instalar as dependencias.",
             "Verifique sua conexao com a internet e rode o iniciar.bat de novo.")
        return False
    MARCADOR_DEPS.write_text("ok", encoding="utf-8")
    return True


def navegador_do_scanner_pronto():
    """O Chromium do Playwright abre? O download fica em cache da maquina."""
    teste = (
        "from playwright.sync_api import sync_playwright\n"
        "p = sync_playwright().start()\n"
        "b = p.chromium.launch(headless=True)\n"
        "b.close()\n"
        "p.stop()\n"
    )
    return roda([str(PYTHON_VENV), "-c", teste])


def instalar_navegador():
    if navegador_do_scanner_pronto():
        passo(2, 4, "Navegador do scanner pronto.")
        return True

    passo(2, 4, "Baixando o navegador do scanner... (uma vez so)")
    if not roda([str(PYTHON_VENV), "-m", "playwright", "install", "chromium"], silencioso=False):
        erro("Falha ao instalar o Chromium do Playwright.",
             "Sem ele a auditoria cai para leitura estatica do HTML:",
             "sem cookies, sem ordem de disparo e sem teste de recusa.")
        return False
    return True


def verificar_configuracao():
    """A aplicacao nao sobe sem SECRET_KEY — melhor avisar aqui."""
    passo(3, 4, "Conferindo a configuracao...")

    env = RAIZ / ".env"
    modelo = RAIZ / ".env.example"
    if not env.exists():
        if modelo.exists():
            env.write_text(modelo.read_text(encoding="utf-8"), encoding="utf-8")
            print("       Arquivo .env criado a partir do modelo.")
        else:
            erro("Arquivo .env nao encontrado e nao ha modelo para copiar.")
            return False

    try:
        from dotenv import load_dotenv
        load_dotenv(env)
    except ImportError:
        pass

    chave = (os.getenv("SECRET_KEY") or "").strip()
    if len(chave) < 32:
        import secrets
        sugestao = secrets.token_urlsafe(48)
        erro("SECRET_KEY ausente ou curta demais no arquivo .env",
             "Ela precisa ter pelo menos 32 caracteres.",
             "",
             "Abra o arquivo .env e cole a linha abaixo:",
             "",
             f"SECRET_KEY={sugestao}")
        return False
    return True


def preparar_banco():
    passo(4, 4, "Preparando o banco de dados...")
    script = RAIZ / "scripts" / "setup_db.py"
    if not roda([str(PYTHON_VENV), str(script)], silencioso=False):
        erro("Falha ao preparar o banco de dados.")
        return False
    return True


def abrir_navegador_depois():
    """Abre o navegador quando a aplicacao ja estiver respondendo."""
    def espera():
        import urllib.request
        for _ in range(40):
            time.sleep(0.5)
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{PORTA}/health", timeout=1)
                webbrowser.open(f"http://127.0.0.1:{PORTA}")
                return
            except Exception:
                continue
    threading.Thread(target=espera, daemon=True).start()


def main():
    cabecalho("DataTrust Audit")

    if not PYTHON_VENV.exists():
        erro("Ambiente virtual nao encontrado.", "Rode o iniciar.bat.")
        return 1

    if not instalar_dependencias():
        return 1
    if not instalar_navegador():
        return 1
    if not verificar_configuracao():
        return 1
    if not preparar_banco():
        return 1

    if "--apenas-preparar" in sys.argv:
        cabecalho("Ambiente pronto.")
        return 0

    cabecalho(f"Pronto. Abrindo http://127.0.0.1:{PORTA}")
    print("  Para encerrar: feche esta janela ou pressione Ctrl+C")
    print()

    abrir_navegador_depois()

    try:
        subprocess.run(
            [str(PYTHON_VENV), "-m", "uvicorn", "main:app",
             "--host", "127.0.0.1", "--port", str(PORTA)],
            cwd=str(RAIZ),
        )
    except KeyboardInterrupt:
        pass

    print()
    print("Aplicacao encerrada.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
