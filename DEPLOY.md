# Colocar no ar

O produto são duas peças com necessidades opostas, e é isso que decide onde
cada uma mora:

- **Frontend** (`static/`) — arquivos estáticos gerados pelo Vite. Encaixa em
  qualquer CDN. Vai para a **Vercel**.
- **Backend** (FastAPI + Playwright) — sobe um Chromium de verdade a cada
  varredura e leva perto de um minuto para responder. **Não roda em serverless**
  — nem na Vercel, nem em Lambda. Precisa de container.

## Por que o backend não vai na Vercel

Não é limitação de configuração; são quatro impedimentos independentes:

- **Não há navegador.** O motor abre a página com Playwright para observar
  cookie gravado, requisição de rede e ordem real de disparo. É disso que o
  laudo é feito. O Chromium do Playwright passa de 250 MB — o teto de uma
  função da Vercel.
- **Tempo.** Uma varredura leva ~60 s. O teto é 10 s no plano gratuito e 60 s
  no Pro. Um laudo por site pesado estoura os dois.
- **Disco efêmero.** `DATABASE_URL` aponta para um SQLite em arquivo. Em
  serverless, cada invocação começa com o disco limpo — o banco apareceria
  vazio a cada requisição.
- **Processo que morre.** O envio de e-mail usa `BackgroundTasks`, que roda
  *depois* da resposta. Em serverless a função é congelada assim que responde,
  e a tarefa nunca executa.

Onde o backend roda bem: **Railway**, **Render**, **Fly.io** ou qualquer VPS com
Docker. Todos aceitam Chromium e processo longo.

## 1. Frontend na Vercel

O `vercel.json` na raiz já traz tudo — não há nada a configurar na interface
além de apontar o repositório:

| Campo | Valor | Por quê |
|---|---|---|
| Build Command | `npm --prefix static ci && npm --prefix static run build` | O frontend mora em `static/`, não na raiz |
| Output Directory | `static/dist` | |
| Framework Preset | Other | O preset de Vite procuraria na raiz |

O `rewrites` manda toda rota desconhecida para `index.html`. Sem ele,
`/pricing` e `/historico` dariam 404: quem resolve essas rotas é o React
Router, no navegador — o servidor só conhece `/`.

A regra exclui `api/`, `analyze` e `chat` de propósito. Se um dia essas
chamadas passarem pela Vercel (ver adiante), elas não podem ser engolidas pelo
`index.html` — a tela receberia HTML onde espera JSON, e o erro apareceria como
"unexpected token <", que não diz nada sobre a causa.

## 2. Backend em container

O `Dockerfile` na raiz já faz tudo: Python 3.13, Chromium com as dependências de
sistema, dependências do `requirements.txt`, usuário sem privilégio e uvicorn
lendo a porta do ambiente. O `.dockerignore` mantém fora do contexto o `.venv`
(centenas de MB de binários de Windows, que sozinhos inviabilizariam o build),
o `.env`, o banco, os testes e o frontend.

Equivalente manual do que a imagem faz:

```bash
pip install -r requirements.txt
playwright install --with-deps chromium
uvicorn main:app --host 0.0.0.0 --port $PORT
```

### Rodar local antes de publicar

```bash
docker build -t datatrust-backend .
docker run --rm -p 8000:8000 \
  --shm-size=1g \
  -e SECRET_KEY="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  -e ENVIRONMENT=production \
  -e DATABASE_URL="postgresql+psycopg://..." \
  -e FRONTEND_URL="https://seu-front.vercel.app" \
  datatrust-backend
```

`--shm-size=1g` não é enfeite: o padrão do Docker para `/dev/shm` é 64 MB, e o
Chromium usa essa área para memória compartilhada entre processos. Estourar o
limite derruba a aba no meio da varredura, e o erro chega como "Target closed" —
que não diz nada sobre memória. O `audit_engine/scanner.py` passa
`--disable-dev-shm-usage`, que contorna o problema, mas o
`audit_engine/browser_fetcher.py` (o caminho principal de auditoria) **não
passa** — por isso o tamanho precisa vir de fora.

A flag vale para `docker run` e docker compose. Railway e Render não expõem esse
ajuste no painel, e não confirmei qual tamanho eles usam: se aparecer "Target
closed" em site pesado lá, esta é a primeira suspeita, e a correção definitiva é
acrescentar `--disable-dev-shm-usage` aos argumentos do `browser_fetcher.py`
(fora do escopo desta mudança, que não toca em código de aplicação).

### Variáveis obrigatórias

O resto está em `.env.example`. **Não coloque o `.env` na imagem** — ele está no
`.dockerignore` de propósito: segredo dentro da imagem é segredo distribuído
junto com ela. Todas essas vão no painel da plataforma.

| Variável | Sem ela |
|---|---|
| `SECRET_KEY` | A aplicação **não sobe**. `api/auth.py` levanta no import se estiver vazia ou com menos de 32 caracteres. Gere com `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `DATABASE_URL` | Cai no SQLite dentro do contêiner — que some a cada deploy, junto com os usuários. Ver abaixo |
| `FRONTEND_URL` | Os links de e-mail e o retorno do checkout apontam para localhost. É também o padrão do CORS quando `CORS_ALLOW_ORIGINS` está vazia |
| `ENVIRONMENT` | Fica em `development`, que é o padrão do código: é o que mantém aberta a rota de troca de plano. Em produção, `production` |
| `CHROMIUM_NO_SANDBOX` | Já vem `1` na imagem — ver a ressalva adiante |

Recomendadas: `CORS_ALLOW_ORIGINS` com o domínio do frontend, `ADMIN_EMAILS`
(vazia = ninguém é promovido, falha fechada de propósito), `SUPABASE_JWT_SECRET`
(sem ela o login pelo Supabase não é aceito) e `RESEND_API_KEY`.

### `DATABASE_URL` precisa sair do SQLite

Com Playwright em paralelo já dá `database is locked` em desenvolvimento; com
mais de um usuário simultâneo é garantido. E em contêiner o problema é pior: o
disco é reconstruído a cada deploy, então o banco em arquivo é apagado sem
aviso. As credenciais do Postgres do Supabase já estão no `.env`.

Use o prefixo `postgresql+psycopg://` (psycopg **3**), não `postgresql://`. O
`requirements.txt` traz só o psycopg 3; com o prefixo curto o SQLAlchemy procura
o psycopg2, que não está instalado, e o contêiner morre no import com
`ModuleNotFoundError` — erro que não menciona banco nem URL.

### Migração: `scripts/setup_db.py`, nunca `alembic upgrade head`

O banco em uso foi criado por `create_all` antes do Alembic e não tem a tabela
`alembic_version`; um upgrade direto tentaria recriar tudo e falharia com
"table already exists". O script detecta isso, carimba a revisão inicial e
aplica só o que falta.

Rode como comando de pré-deploy (campo próprio nas duas plataformas) ou uma vez
em shell:

```bash
python scripts/setup_db.py
```

Não ligue `DB_AUTO_CREATE=1` em produção: `create_all` cria tabela que falta mas
não altera tabela existente, então uma coluna nova simplesmente não aparece e o
erro só surge no primeiro INSERT.

### Health check: `/health`, nunca `/`

Aponte a sonda da plataforma para `/health`. Ela verifica o banco de verdade
(`SELECT 1`) e responde `degraded` quando ele não responde.

`/` **não é a interface** nesta imagem: o build do frontend não entra no
contêiner (está na Vercel). O que responde ali é uma página fixa de uma linha,
escrita pelo próprio Dockerfile, dizendo que este endereço serve a API.

Ela não é enfeite. `GET /` e o catch-all `/{full_path:path}` de `main.py`
devolvem `FileResponse(static/dist/index.html)` sem checar se o arquivo existe,
e `FileResponse` de caminho inexistente vira `RuntimeError` — ou seja, **500 com
traceback** em toda rota que não seja da API. Como a sonda padrão de várias
plataformas aponta para `/`, o serviço subia saudável e era derrubado por um
erro que não tinha nada a ver com saúde.

Pelo mesmo motivo o Dockerfile cria `static/dist/assets` vazio: `main.py` monta
`StaticFiles` nesse caminho no import, e o Starlette levanta
`RuntimeError: Directory ... does not exist` antes de a aplicação existir. Sem o
diretório, o contêiner nem sobe.

Ainda assim, aponte a sonda para `/health`: a página da raiz responde 200 mesmo
com o banco fora do ar, porque é um arquivo estático — ela diz que o processo
está de pé, não que o serviço está são.

### A ressalva do `CHROMIUM_NO_SANDBOX`

A imagem define `CHROMIUM_NO_SANDBOX=1`. O sandbox do Chromium é a barreira
entre o processo que renderiza a página e o resto da máquina — e aqui o conteúdo
renderizado é atacante em potencial, porque é qualquer site que o usuário mandar
auditar. Desligá-lo só é aceitável sob a condição que o contêiner cria:
processo isolado, usuário sem privilégio, sistema de arquivos descartável.
**Fora de contêiner, mantenha `0`.**

Duas observações honestas sobre o alcance dessa variável:

- Ela governa apenas `audit_engine/scanner.py`. O caminho principal
  (`audit_engine/browser_fetcher.py`, usado por `auditar_pagina`) passa
  `--no-sandbox` fixo no código, independentemente dela — na prática o sandbox
  já está desligado ali hoje, em qualquer ambiente.
- Em contêiner, deixar `0` tende a impedir o Chromium de abrir: sem SUID helper
  e sem user namespace liberado, ele falha ao iniciar o sandbox.

### 2.1 Railway

1. **New Project → Deploy from GitHub repo**, apontando para este repositório.
   O Dockerfile na raiz é detectado sozinho; não escolha nenhum buildpack.
2. **Variables** → cole as obrigatórias da tabela acima.
3. **Settings → Deploy → Health Check Path** → `/health`. O padrão não checa
   nada, e um contêiner que sobe quebrado fica marcado como saudável.
4. **Settings → Deploy → Pre-Deploy Command** → `python scripts/setup_db.py`.
5. **Settings → Networking → Generate Domain** — é essa URL
   (`https://algo.up.railway.app`) que vai no rewrite da Vercel.

`PORT` é injetada pela Railway; não a defina à mão. O `CMD` do Dockerfile já lê
`${PORT:-8000}` — fixar 8000 faria a sonda bater em porta fechada e o deploy
cairia por timeout, sem mensagem que apontasse para a porta.

### 2.2 Render

1. **New + → Web Service** → conecte o repositório. Em **Language/Runtime**
   escolha **Docker** (o Dockerfile na raiz é usado como está).
2. **Instance Type**: não use a faixa de 512 MB. Cada varredura sobe um Chromium
   completo; o contêiner é morto por OOM no meio do laudo, e o sintoma é um 502
   sem log de exceção — parece rede, é memória. Comece com 2 GB.
3. **Environment** → as variáveis obrigatórias.
4. **Health Check Path** → `/health`.
5. **Pre-Deploy Command** → `python scripts/setup_db.py`.

No plano gratuito o serviço hiberna por inatividade: a primeira requisição paga
o tempo de subir o contêiner **mais** os ~60 s da varredura, e o navegador do
cliente costuma desistir antes. Para uso real, plano que não hiberna.

### Um serviço só

Não crie um segundo serviço de worker. O Celery está configurado em `worker/`,
mas `api/scans.py` dispara a varredura por `BackgroundTasks` — o Chromium sobe
dentro do próprio processo web. Um worker separado ficaria ocioso.

Pela mesma razão, cuidado ao subir réplicas: `RATE_LIMIT_STORAGE_URI=memory://`
conta por processo, então o teto real vira N × o configurado. Com mais de uma
réplica, aponte para um Redis.

## 3. Ligar um ao outro

O frontend chama `/api/...` em caminho relativo, em 15 lugares. Em
desenvolvimento o proxy do Vite resolve; em produção, quem resolve é um rewrite
na Vercel, acrescentado ao `vercel.json` **depois** que o backend tiver URL:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "npm --prefix static ci && npm --prefix static run build",
  "outputDirectory": "static/dist",
  "installCommand": "echo 'dependencias instaladas no buildCommand'",
  "framework": null,
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://SEU-BACKEND.up.railway.app/api/:path*"
    },
    {
      "source": "/chat",
      "destination": "https://SEU-BACKEND.up.railway.app/chat"
    },
    {
      "source": "/((?!api/|analyze|chat|assets/|favicon|robots).*)",
      "destination": "/index.html"
    }
  ]
}
```

Ele precisa vir **antes** da regra do SPA no array — a Vercel aplica a primeira
que casa. Trocar a ordem faz a tela receber HTML onde espera JSON, e o erro
aparece como "unexpected token <", que não diz nada sobre a causa.

A alternativa seria uma variável `VITE_API_URL` lida por um wrapper de fetch,
mas isso exigiria mexer nos 15 pontos de chamada. O rewrite não toca no código
e mantém a origem única, o que também evita CORS.

**Como conferir que ligou**, sem depender da interface:

```bash
curl https://SEU-BACKEND.up.railway.app/health   # direto no backend
curl https://SEU-FRONT.vercel.app/health         # deve dar 404: /health não é /api/*
curl https://SEU-FRONT.vercel.app/api/payments/plans
```

A terceira precisa devolver JSON de preços. Se devolver HTML, o rewrite não foi
aplicado ou está depois da regra do SPA.

### Por que existe uma regra só para `/chat`

Duas rotas do backend não têm o prefixo `/api`: `/analyze` e `/chat`. O
`vercel.json` exclui as duas da regra do SPA, mas o rewrite `/api/:path*` não as
alcança — e `/chat` **é usada hoje**, por `static/src/components/AIChat.tsx`
(linha 170, `fetch('/chat')`). Sem regra própria ela cai no vazio: a Vercel não
tem essa rota, o SPA foi instruído a não engoli-la, e o chat responde 404 em
produção enquanto o resto do produto funciona — falha parcial, que é a mais
difícil de perceber.

`/analyze` não precisa de regra: é o motor legado do `main.py` e nenhuma tela o
chama (`services/analiseEmTempoReal.ts` menciona a rota só em comentário,
explicando por que deixou de usá-la). Se um dia voltar a ser chamada, precisa
da mesma regra que `/chat`.

## 4. O que ainda não está pronto

- **Telas do PIX e painel admin.** O backend está completo e testado
  (`/api/payments/pix/*` e `/api/admin/*`), mas a interface ainda não existe. O
  checkout hoje só oferece o caminho do Mercado Pago.
- **Mercado Pago desativado.** Enquanto estiver assim, cartão não é uma opção
  real — o checkout responde 503, que é o comportamento correto (já devolveu um
  link de fallback que não levava a lugar nenhum, e o cliente achava que tinha
  comprado).
- **`MP_WEBHOOK_SECRET` vazio.** Sem ele o webhook aceita POST de qualquer
  origem: qualquer um pode forjar uma confirmação de pagamento. Preencher antes
  de reativar o Mercado Pago.
- **Postgres.** Ver acima.

## Registro anterior

A tag `v1-antes-do-hardening` marca o estado do `main` antes desta rodada.
Voltar a ele é `git checkout v1-antes-do-hardening` — nada foi sobrescrito.
