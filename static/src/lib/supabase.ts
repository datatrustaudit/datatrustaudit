import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// ── Validate environment variables ──
const PLACEHOLDER_PATTERNS = ['COLE_', 'YOUR_', 'CHANGE_', 'REPLACE_', 'AQUI', 'TODO'];

function isPlaceholder(value: string): boolean {
  const upper = value.toUpperCase();
  return PLACEHOLDER_PATTERNS.some(p => upper.includes(p));
}

if (!supabaseUrl) {
  const msg =
    '[DataTrust] VITE_SUPABASE_URL não está definido.\n' +
    'Adicione ao seu arquivo .env na raiz do projeto:\n' +
    'VITE_SUPABASE_URL=https://ytxihfhzawnetenbfkzz.supabase.co\n\n' +
    'Se você está usando Vite, verifique se vite.config.ts contém envDir: ".."';
  console.error(msg);
  throw new Error(msg);
}

if (!supabaseAnonKey || isPlaceholder(supabaseAnonKey)) {
  const msg =
    '[DataTrust] VITE_SUPABASE_ANON_KEY está ausente ou é um placeholder.\n' +
    'Valor atual: "' + supabaseAnonKey + '"\n\n' +
    'Para obter a anon key:\n' +
    '1. Abra o Supabase Dashboard: https://supabase.com/dashboard/project/ytxihfhzawnetenbfkzz/settings/api\n' +
    '2. Copie a "anon public" key\n' +
    '3. Cole no .env: VITE_SUPABASE_ANON_KEY=eyJhbGci...\n\n' +
    'A anon key é segura para o frontend — ela NÃO é o service_role secret.';
  console.error(msg);
  throw new Error(msg);
}

// ── Validate URL format ──
if (supabaseUrl.endsWith('/rest/v1') || supabaseUrl.endsWith('/rest/v1/')) {
  const msg =
    '[DataTrust] VITE_SUPABASE_URL contém "/rest/v1/" — isto está ERRADO.\n' +
    'Use a URL do projeto sem /rest/v1/:\n' +
    'VITE_SUPABASE_URL=https://ytxihfhzawnetenbfkzz.supabase.co';
  console.error(msg);
  throw new Error(msg);
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
