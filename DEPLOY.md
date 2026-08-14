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

```bash
pip install -r requirements.txt
playwright install --with-deps chromium
uvicorn main:app --host 0.0.0.0 --port $PORT
```

Variáveis obrigatórias (o resto está em `.env.example`):

| Variável | Sem ela |
|---|---|
| `SECRET_KEY` | A aplicação não sobe |
| `DATABASE_URL` | Cai no SQLite local — ver a seção seguinte |
| `FRONTEND_URL` | Os links de e-mail e o retorno do checkout apontam para localhost |
| `ENVIRONMENT` | Fica diferente de `development`, que é o correto em produção: é o que fecha a rota de troca de plano |

**`DATABASE_URL` precisa sair do SQLite.** Com Playwright em paralelo já dá
`database is locked` em desenvolvimento; com mais de um usuário simultâneo é
garantido. As credenciais do Postgres do Supabase já estão no `.env`.

## 3. Ligar um ao outro

O frontend chama `/api/...` em caminho relativo, em 15 lugares. Em
desenvolvimento o proxy do Vite resolve; em produção, quem resolve é um rewrite
na Vercel, acrescentado ao `vercel.json` **depois** que o backend tiver URL:

```json
{
  "source": "/api/:path*",
  "destination": "https://SEU-BACKEND.up.railway.app/api/:path*"
}
```

Ele precisa vir **antes** da regra do SPA no array — a Vercel aplica a primeira
que casa.

A alternativa seria uma variável `VITE_API_URL` lida por um wrapper de fetch,
mas isso exigiria mexer nos 15 pontos de chamada. O rewrite não toca no código
e mantém a origem única, o que também evita CORS.

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
