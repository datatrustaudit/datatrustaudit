"""Menu de ferramentas: testes e auditoria pelo terminal. Chamado pelo testar.bat."""
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
PYTHON_VENV = RAIZ / ".venv" / "Scripts" / "python.exe"
if not PYTHON_VENV.exists():
    PYTHON_VENV = RAIZ / ".venv" / "bin" / "python"


def roda(comando):
    return subprocess.run(comando, cwd=str(RAIZ)).returncode


def pede_url():
    url = input("Endereco do site (ex: https://www.exemplo.com.br): ").strip()
    if not url:
        print("Nenhum endereco informado.")
        return None
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def main():
    print()
    print("=" * 60)
    print("  DataTrust Audit - ferramentas")
    print("=" * 60)
    print()
    print("  [1] Rodar a suite de testes")
    print("  [2] Auditar um site")
    print("  [3] Auditar um site e testar o botao Recusar")
    print("  [4] Sair")
    print()

    try:
        opcao = input("Escolha: ").strip()
    except (EOFError, KeyboardInterrupt):
        return 0

    auditar = str(RAIZ / "scripts" / "auditar.py")

    if opcao == "1":
        print()
        return roda([str(PYTHON_VENV), "-m", "pytest", "-q"])

    if opcao == "2":
        url = pede_url()
        if not url:
            return 1
        print(f"\nAuditando {url} ... leva cerca de 30 segundos.\n")
        return roda([str(PYTHON_VENV), auditar, url])

    if opcao == "3":
        url = pede_url()
        if not url:
            return 1
        print(f"\nAuditando {url} e testando a recusa de consentimento...\n")
        return roda([str(PYTHON_VENV), auditar, url, "--recusa"])

    if opcao == "4":
        return 0

    print("Opcao invalida.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
