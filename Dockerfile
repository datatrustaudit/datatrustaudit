# DataTrust Audit — imagem do backend (FastAPI + Playwright)
#
# Este contêiner existe porque o backend não cabe em serverless: sobe um
# Chromium de verdade por varredura, leva ~60 s para responder e manda e-mail
# em BackgroundTasks (que roda DEPOIS da resposta — em serverless a função é
# congelada nesse ponto e a tarefa nunca executa). Ver DEPLOY.md.

# Debian 12 (bookworm) é escolha deliberada, e o codinome está pinado de
# propósito: a tag flutuante `python:3.13-slim` acompanha a release nova do
# Debian, e o `playwright install --with-deps` só conhece um conjunto fechado
# de distribuições (nesta versão: debian11/12/13 e ubuntu 20.04/22.04/24.04).
# No dia em que a tag flutuante apontar para uma distribuição que o Playwright
# ainda não mapeia, o build quebra no meio, num deploy que não mudou nada.
FROM python:3.13-slim-bookworm

# PYTHONUNBUFFERED: sem ele o stdout fica em buffer de bloco e os print() de
# diagnóstico do startup só aparecem no log da plataforma muito depois — ou
# nunca, se o processo morrer antes de esvaziar o buffer. Num deploy que falha,
# é justamente esse log que diz o porquê.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# O Chromium é instalado como root, mas quem executa é um usuário sem
# privilégio. Sem esta variável o navegador iria para /root/.cache/ms-playwright,
# que o usuário da aplicação não consegue ler — e a falha aparece só na primeira
# varredura, como "Executable doesn't exist", muito depois do build passar.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Dependências Python antes do código: só o requirements.txt invalida esta
# camada, então mudança de código não reinstala nada nem rebaixa o Chromium.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# --with-deps instala as bibliotecas de sistema do Chromium (libnss3, libasound2,
# fontes, etc.) via apt. Sem elas o binário existe e mesmo assim não abre: o erro
# é um "Host system is missing dependencies" no meio da primeira varredura.
# Só chromium — firefox e webkit somam centenas de MB que o produto não usa.
RUN playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# O download do Chromium roda como root e nasce restrito ao dono. O usuário da
# aplicação precisa de leitura e de +x nos diretórios para chegar ao binário.
RUN chmod -R a+rX /ms-playwright

# Usuário sem privilégio: o scanner renderiza sites arbitrários — o conteúdo
# processado aqui é atacante em potencial. --create-home porque o Chromium
# escreve o perfil temporário dentro de $HOME e falha se ele não for gravável.
RUN useradd --create-home --uid 10001 --shell /bin/sh appuser

COPY --chown=appuser:appuser . .

# main.py monta StaticFiles em static/dist/assets no nível do módulo, e o
# Starlette levanta RuntimeError("Directory ... does not exist") já no import
# quando o diretório falta. Como o build do frontend NÃO entra nesta imagem
# (ele é publicado na Vercel; ver .dockerignore), sem este mkdir a aplicação
# não sobe — e o erro aparece como crash de importação, sem citar o frontend.
#
# O index.html não é decoração: `GET /` e o catch-all `/{full_path:path}` de
# main.py devolvem `FileResponse(static/dist/index.html)` sem checar se o
# arquivo existe, e o `FileResponse` de um caminho inexistente vira
# RuntimeError — ou seja, **500 com traceback** em toda rota que não seja da
# API, inclusive na raiz, que é onde a maioria das plataformas aponta a sonda
# padrão. Uma página que diz o que este endereço é custa 400 bytes e troca o
# erro de servidor por uma resposta verdadeira.
RUN mkdir -p /app/static/dist/assets \
    && printf '%s\n' \
        '<!doctype html>' \
        '<html lang="pt-BR"><head><meta charset="utf-8">' \
        '<meta name="robots" content="noindex">' \
        '<title>DataTrust Audit — API</title></head><body>' \
        '<h1>DataTrust Audit — API</h1>' \
        '<p>Este endereço serve a API. A interface do produto é publicada separadamente.</p>' \
        '<p>Estado do serviço: <a href="/health">/health</a></p>' \
        '</body></html>' \
        > /app/static/dist/index.html \
    && chown -R appuser:appuser /app/static

# O banco SQLite padrão é gravado em /app/db pela própria aplicação. Em produção
# o DATABASE_URL deve apontar para o Postgres (ver DEPLOY.md) — o diretório
# gravável existe para o caso de desenvolvimento local, não como recomendação.
RUN mkdir -p /app/db && chown -R appuser:appuser /app/db

# Desliga o sandbox do Chromium. A condição para isso ser aceitável é
# exatamente a que este arquivo cria: processo isolado em contêiner, sob usuário
# sem privilégio. Fora de contêiner, mantenha CHROMIUM_NO_SANDBOX=0.
# Atenção: esta variável só governa audit_engine/scanner.py. O caminho principal
# de auditoria (audit_engine/browser_fetcher.py) passa --no-sandbox fixo no
# código, independentemente dela.
ENV CHROMIUM_NO_SANDBOX=1

USER appuser

# Documental apenas — a porta real vem do ambiente (ver CMD).
EXPOSE 8000

# Verificação local/compose. Railway e Render usam a sonda HTTP deles (aponte
# para /health na interface); esta aqui é para `docker run` e docker compose.
# urllib em vez de curl: a imagem slim não traz curl, e instalá-lo só para isso
# adiciona superfície sem necessidade.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.getenv('PORT','8000')+'/health', timeout=8).status==200 else 1)"

# A porta VEM do ambiente. Railway e Render injetam $PORT e fazem o health check
# nela; fixar 8000 faz a sonda bater numa porta fechada e o deploy é derrubado
# por timeout, sem nenhuma mensagem que aponte para a porta.
#
# Formato shell (e não exec) porque a forma exec não expande ${PORT}: o uvicorn
# receberia a string literal "${PORT:-8000}" e morreria no parse. O `exec` faz o
# uvicorn substituir o shell e virar PID 1, para receber o SIGTERM do deploy
# direto e encerrar limpo — sem ele, o shell segura o sinal e a plataforma mata
# o contêiner no grito depois do timeout.
CMD ["sh", "-c", "exec uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
