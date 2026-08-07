# DataTrust Audit — instruções do projeto

SaaS B2B de auditoria de tags, GA4/GTM e conformidade LGPD/GDPR.
FastAPI + SQLAlchemy + Playwright no backend, React/Vite (shadcn) em `static/`.

## Como rodar

```bash
pip install -r requirements.txt
playwright install chromium
cp .env.example .env      # preencher SECRET_KEY — a aplicação não sobe sem ela
alembic upgrade head
uvicorn main:app --reload
```

Testes: `pytest` (60 casos, um por bug já corrigido — ver `tests/`).

## Convenções

- **Idioma:** código e identificadores em inglês onde já existiam; comentários,
  docstrings novas e mensagens ao usuário em português. Testes em português.
- **Rotas:** `api/` para routers com prefixo `/api/...`; `main.py` guarda o
  motor legado e as rotas sem prefixo (`/analyze`, `/chat`).
- **Banco:** só por migration Alembic. `create_all` está desligado no startup
  (só roda com `DB_AUTO_CREATE=1`, para desenvolvimento).

## Armadilhas deste projeto

Coisas que já quebraram aqui e não são óbvias lendo o código.

### O catch-all do SPA precisa ser a última rota

`@app.get("/{full_path:path}")` casa com qualquer GET. Starlette entrega para a
primeira rota registrada que casa, então qualquer `@app.get` declarado depois
dele fica inalcançável. Já engoliu `/health` (quebrando o health check do
deploy), `/history`, `/lgpd-info`, `/favicon.ico` e `/robots.txt` — e escondeu
por meses um `NameError` em `/lgpd-info`, porque a rota nunca era executada.
**Não declare nenhum `@app.get` depois do bloco final de `main.py`.**

### `scan.findings` é relationship, não coluna JSON

Atribuir `list[dict]` levanta `AttributeError: 'dict' object has no attribute
'_sa_instance_state'`. Use instâncias de `Finding`. O detalhe cruel: com lista
vazia funciona, então o scan só falhava quando encontrava algum problema.

### As chaves de `scan.raw_data` são snake_case

`raw_data` vem de `jsonable_encoder(audit_result)`, que serializa a dataclass
via `asdict` e **ignora** o `to_dict()` camelCase de `audit_engine/models.py`.
Ler `estimatedRiskExposure` ou `totalViolations` de `raw_data` devolve vazio
silenciosamente. Já fez o gating do plano free não esconder nada e o PDF sair
sem violações. O motor legado de `main.py` usa camelCase — os dois convivem.

### Plano nunca vem do cliente

Use `api.auth.resolve_effective_plan(current_user)`. O campo `plan` do corpo da
requisição é ignorado de propósito: aceitar ele já entregou relatório premium
completo para anônimo. Anônimo é sempre `free`.

### URL de destino passa por `audit_engine/url_guard.py`

Fonte única. Não escreva validação nova: as três anteriores divergiam e a mais
fraca deixava passar `169.254.169.254` (credenciais IAM da AWS). O scanner
revalida por request, o que cobre redirect e DNS rebinding.

### Há dois campos de status de assinatura, e eles divergem

`Subscription.status` (active/past_due/canceled) e `User.subscription_status`
(inactive/active/pending/canceled) descrevem a mesma coisa. A fonte da verdade
é a **Subscription** — `User.plan` decide por ela e por `current_period_end`.
`User.subscription_status` é espelho para o frontend e para
`has_active_subscription`, sincronizado em `api/payments._ativar_plano`.
Consultar o espelho na hora de decidir o plano derruba para "free" todo
pagante cujo campo ficou defasado; ao mexer nisso, mantenha os dois em sincronia.

### `Subscription.weekly_scan_count` não é incrementado por ninguém

Só é lido (`User.scans_used`) e zerado por `scripts/create_admin_user.py`.
Quem conta de verdade é a tabela `scans`, via
`api.scans.contar_scans_da_semana` — é a fonte que o limite usa. Para exibir
uso ao usuário, use `api.auth._serialize_user(user, db)`, que consulta o valor
real; sem o `db` ele cai no campo desatualizado e mostra 0.

### Autenticação aceita dois tipos de token

`get_current_user` tenta o JWT local e, se falhar, o JWT do Supabase
(`SUPABASE_JWT_SECRET`), criando o usuário local na primeira vez. Ao mexer em
autenticação, teste os dois caminhos.

### `get_current_user` pode devolver `None`

É de propósito (auditoria grátis sem cadastro). Para rota que exige login use
`get_current_active_user` — usar o primeiro e acessar `current_user.id` gera
500 em vez de 401.

### passlib 1.7.4 e bcrypt

bcrypt ≥ 4.1 removeu `__about__`, que o passlib lê. `requirements.txt` fixa
`bcrypt>=4.0,<4.1`. Não solte esse pino sem testar hash e verify de verdade.

### SQLite `:memory:` nos testes

Com o pool padrão do SQLAlchemy, cada conexão abre um banco novo e vazio — as
tabelas somem entre requisições. `tests/conftest.py` usa arquivo temporário.

### E-mails de teste

`email-validator` rejeita TLDs reservados (`.test`, `.invalid`). Use domínio
com TLD real nos testes.

## Débito conhecido

- `DATABASE_URL` ainda em SQLite. Com Playwright em paralelo dá
  `database is locked`. Migrar para o Postgres do Supabase (credenciais no `.env`).
- Cobrança: o frontend (`Checkout.tsx`) redireciona para a Kiwify, mas não existe
  webhook da Kiwify no backend — quem paga por lá depende de ativação manual.
  O backend tem Mercado Pago pronto (`/api/payments`), com HMAC no webhook;
  falta o frontend usá-lo e as credenciais `MP_ACCESS_TOKEN` / `MP_WEBHOOK_SECRET`.
- Celery está configurado mas não é usado: `api/scans.py` chama a task via
  `BackgroundTasks`, então o Chromium sobe dentro do processo web, sem pool nem
  teto de concorrência.
- `main.py` mantém um motor de auditoria próprio, paralelo ao `audit_engine/`.
- O frontend manda URLs de clientes para proxies de terceiros (`allorigins`,
  `cors-anywhere`, `thingproxy`) — sem contrato, num produto de compliance.
- `static/dist/` é build antigo; precisa de rebuild para refletir `static/src/`.
- `legacy_attic/`, `static_broken/`, `db_broken/`, `audit_engine_old/` seguem no
  disco, fora do git. Podem ser apagados quando não forem mais necessários.
