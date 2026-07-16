# DataTrust Audit

Auditoria de Google Tag Manager + Conformidade LGPD/GDPR.

## Requisitos

- **Node.js** 18+ (frontend)
- **Python** 3.8+ (backend FastAPI)
- **Supabase** account (auth + profiles)

## Setup Rápido

### 1. Criar `.env`

Copie o `.env.example` e preencha os valores:

```bash
cp .env.example .env
```

**Variáveis obrigatórias:**

| Variável | Descrição | Onde obter |
|----------|-----------|------------|
| `VITE_SUPABASE_URL` | URL do projeto Supabase | Supabase Dashboard > Settings > API |
| `VITE_SUPABASE_ANON_KEY` | Anon public key | Supabase Dashboard > Settings > API |
| `SUPABASE_JWT_SECRET` | JWT secret (backend) | Supabase Dashboard > Settings > API |
| `GOOGLE_API_KEY` | Gemini API key | https://aistudio.google.com/app/apikey |
| `SECRET_KEY` | JWT secret (backend local) | Gere uma string segura |

> ⚠️ **IMPORTANTE:** O `.env` fica na raiz do projeto (mesmo nível que `main.py`).
> O Vite lê variáveis `VITE_*` deste arquivo via `envDir: '..'` no `vite.config.ts`.

### 2. Supabase URL — CUIDADO

Use a URL do projeto **sem** `/rest/v1/`:

```
✅ VITE_SUPABASE_URL=https://ytxihfhzawnetenbfkzz.supabase.co
❌ VITE_SUPABASE_URL=https://ytxihfhzawnetenbfkzz.supabase.co/rest/v1/
```

### 3. Frontend

```bash
cd static
npm install
npm run dev       # Desenvolvimento (porta 8080)
npm run build     # Build de produção
```

### 4. Backend

```bash
python -m venv .venv
.venv\Scripts\activate       # Windows
source .venv/bin/activate    # Linux/Mac
pip install -r req.txt
uvicorn main:app --reload --port 8000
```

Ou use o script integrado:

```bash
python run.py --dev
```

### 5. Supabase — Tabela `profiles`

Execute no SQL Editor do Supabase:

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  plan text default 'free',
  subscription_status text default 'inactive',
  is_admin boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can insert own profile"
on public.profiles for insert
with check (auth.uid() = id);
```

### 6. Admin

```sql
-- Configurar admin
update public.profiles
set is_admin = true, plan = 'premium', subscription_status = 'active', updated_at = now()
where email = 'datatrustaudit@gmail.com';

-- Remover admin antigo
update public.profiles
set is_admin = false, updated_at = now()
where email = 'digitalfistpower@gmail.com';
```

## Arquitetura Auth

| Camada | Tecnologia |
|--------|-----------|
| **Frontend Auth** | Supabase Auth (email/password + Google OAuth) |
| **Frontend Profile** | Supabase `public.profiles` |
| **Backend Auth** | FastAPI + JWT (aceita Supabase JWT + local JWT) |
| **Backend DB** | SQLAlchemy + SQLite (`db/gtmaudit.db`) |
| **Scan Tracking** | Backend SQLite (weekly limits, credits) |

## Admin

- **Email admin:** `datatrustaudit@gmail.com`
- **PIX key:** `datatrustaudit@gmail.com`
- Admin controlado por `is_admin = true` no profile

## Planos

| Plano | Scans/semana | Preço |
|-------|-------------|-------|
| Free | 10 | R$ 0 |
| Pro | 50 | R$ 49,90/mês |
| Premium | 200 | R$ 149,90/mês |
| Admin | Ilimitado | Interno |

**Pagamento:** Kiwify (configurar `VITE_KIWIFY_*` URLs no `.env`)

## Health Check

```
GET /health
```

Retorna status do DB, env vars e API.

## Debugging API 500

1. Abra o terminal do backend e procure o **traceback completo**
2. Verifique `/health` para status rápido
3. Causas comuns:
   - `VITE_SUPABASE_ANON_KEY` é placeholder (`COLE_A_ANON_PUBLIC_KEY_AQUI`)
   - `SUPABASE_JWT_SECRET` vazio — backend não valida tokens Supabase
   - Tabela `profiles` não existe no Supabase
   - RLS bloqueando acesso ao profile
   - Backend não está rodando (porta 8000)
   - `envDir: '..'` ausente no `vite.config.ts`

## Troubleshooting Checklist

- [ ] `.env` existe na raiz do projeto?
- [ ] `VITE_SUPABASE_URL` é a URL do projeto (sem `/rest/v1/`)?
- [ ] `VITE_SUPABASE_ANON_KEY` é a chave real (não placeholder)?
- [ ] Tabela `public.profiles` existe no Supabase?
- [ ] RLS está habilitado com policies corretas?
- [ ] `datatrustaudit@gmail.com` tem `is_admin = true` no Supabase?
- [ ] Backend está rodando na porta 8000?
- [ ] `SUPABASE_JWT_SECRET` está no `.env`?
- [ ] `vite.config.ts` tem `envDir: '..'`?
- [ ] Google OAuth configurado no Supabase Dashboard?
