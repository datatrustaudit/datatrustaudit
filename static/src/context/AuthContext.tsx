import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { supabase, authDisponivel, motivoDaFaltaDeAuth } from '@/lib/supabase';
import type { Session, User as SupabaseUser, AuthError } from '@supabase/supabase-js';

// ── Public User interface (consumed by PlanContext, AdminPlanTesting, etc.) ──
export interface User {
    id: string | number;
    email: string;
    name: string;
    plan: 'free' | 'pro' | 'premium' | string;
    is_admin: boolean;
    subscription_status: string;  // inactive|active|pending|canceled
    effective_plan: string;       // free|pro|premium|admin
    scans_limit: number;          // -1 = unlimited
    scans_used: number;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
    loginWithGoogle: () => Promise<void>;
    logout: () => void;
    refreshProfile: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Error class (kept for backward compatibility with Auth.tsx) ──
type AuthErrorCode =
    | 'LOGIN_FAILED'
    | 'SIGNUP_FAILED'
    | 'EMAIL_ALREADY_REGISTERED'
    | 'NAME_REQUIRED'
    | 'PASSWORD_TOO_SHORT'
    | 'VALIDATION_FAILED'
    | 'NON_JSON_RESPONSE';

export class AuthRequestError extends Error {
    code: AuthErrorCode;
    status: number;

    constructor(message: string, code: AuthErrorCode, status: number) {
        super(message);
        this.name = 'AuthRequestError';
        this.code = code;
        this.status = status;
    }
}

// ── Admin email from env ──
const ADMIN_EMAIL = (import.meta.env.VITE_ADMIN_EMAIL || 'datatrustaudit@gmail.com').toLowerCase();

// ── Profile helpers ──

interface Profile {
    id: string;
    email: string;
    full_name: string | null;
    plan: string;
    subscription_status: string;
    is_admin: boolean;
}

/**
 * Load profile from public.profiles. Falls back gracefully if table
 * does not exist or RLS blocks the read.
 */
async function loadProfile(userId: string): Promise<Profile | null> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('id, email, full_name, plan, subscription_status, is_admin')
            .eq('id', userId)
            .single();

        if (error) {
            if (import.meta.env.DEV) {
                console.warn('[Auth] Profile fetch error (may be missing table/RLS):', error.message);
            }
            return null;
        }
        return data as Profile;
    } catch (err) {
        if (import.meta.env.DEV) console.warn('[Auth] Profile fetch exception:', err);
        return null;
    }
}

/**
 * Ensure a profile row exists for the Supabase user.
 * Called after signup or first Google login.
 */
async function ensureProfile(sbUser: SupabaseUser, fullName?: string): Promise<void> {
    try {
        const email = sbUser.email ?? '';
        const name = fullName
            || sbUser.user_metadata?.full_name
            || sbUser.user_metadata?.name
            || email.split('@')[0];

        const isAdmin = email.toLowerCase() === ADMIN_EMAIL;

        const { error } = await supabase.from('profiles').upsert(
            {
                id: sbUser.id,
                email,
                full_name: name,
                plan: isAdmin ? 'premium' : 'free',
                subscription_status: isAdmin ? 'active' : 'inactive',
                is_admin: isAdmin,
                updated_at: new Date().toISOString(),
            },
            { onConflict: 'id' }
        );

        if (error && import.meta.env.DEV) {
            console.warn('[Auth] Profile upsert error:', error.message);
        }
    } catch (err) {
        if (import.meta.env.DEV) console.warn('[Auth] ensureProfile exception:', err);
    }
}

/**
 * Build the public User object from Supabase session + profile.
 */
function buildUser(sbUser: SupabaseUser, profile: Profile | null): User {
    const email = sbUser.email ?? '';
    const isAdmin = profile?.is_admin ?? (email.toLowerCase() === ADMIN_EMAIL);
    const plan = profile?.plan || 'free';

    return {
        id: sbUser.id,
        email,
        name: profile?.full_name || sbUser.user_metadata?.full_name || sbUser.user_metadata?.name || '',
        plan,
        is_admin: isAdmin,
        subscription_status: profile?.subscription_status || 'inactive',
        effective_plan: isAdmin ? 'admin' : plan,
        scans_limit: isAdmin ? -1 : ({ free: 10, pro: 50, premium: 200 }[plan] ?? 10),
        scans_used: 0, // Reset on load; backend tracks real usage
    };
}

// ── Also sync with backend if available (for scan tracking) ──
async function syncWithBackend(accessToken: string): Promise<Partial<User> | null> {
    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${accessToken}` },
        });
        if (res.ok) {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            if (ct.includes('application/json')) {
                return await res.json();
            }
        }
    } catch {
        // Backend may not be running or not configured for Supabase JWT
    }
    return null;
}

// ═══════════════════════════════════════════════════════════════
// Provider
// ═══════════════════════════════════════════════════════════════

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // ── Load user from session ──
    const handleSession = useCallback(async (session: Session | null) => {
        if (!session?.user) {
            setUser(null);
            setToken(null);
            setIsLoading(false);
            return;
        }

        const sbUser = session.user;
        const accessToken = session.access_token;
        setToken(accessToken);

        // Load profile from Supabase
        let profile = await loadProfile(sbUser.id);

        // If no profile exists, create one
        if (!profile) {
            await ensureProfile(sbUser);
            profile = await loadProfile(sbUser.id);
        }

        let appUser = buildUser(sbUser, profile);

        // Try to sync with backend for scan usage tracking
        const backendData = await syncWithBackend(accessToken);
        if (backendData) {
            appUser = {
                ...appUser,
                scans_used: backendData.scans_used ?? appUser.scans_used,
                scans_limit: backendData.scans_limit ?? appUser.scans_limit,
                // Backend is_admin and plan take precedence if available
                is_admin: backendData.is_admin ?? appUser.is_admin,
                plan: backendData.plan ?? appUser.plan,
                effective_plan: backendData.effective_plan ?? appUser.effective_plan,
                subscription_status: backendData.subscription_status ?? appUser.subscription_status,
            };
        }

        setUser(appUser);
        setIsLoading(false);
    }, []);

    // ── Initialize: check existing session + listen for auth changes ──
    useEffect(() => {
        /* Sem configuração de autenticação não há sessão a buscar, e chamar
           `supabase.auth` aqui estouraria — o cliente é null nesse caso.
           `isLoading` precisa ir a false mesmo assim: quem espera por ele
           mostra "carregando" para sempre, e o resultado é a mesma tela branca
           que se está tentando evitar. */
        if (!authDisponivel) {
            setIsLoading(false);
            return;
        }

        // Get initial session
        supabase.auth.getSession().then(({ data: { session } }) => {
            handleSession(session);
        });

        // Listen for auth state changes (login, logout, token refresh)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
            (_event, session) => {
                handleSession(session);
            }
        );

        return () => subscription.unsubscribe();
    }, [handleSession]);

    /* As ações de conta precisam recusar com a explicação, e não estourar
       "Cannot read properties of null" — que manda quem for investigar
       procurar um bug de código onde existe uma variável de ambiente
       faltando. */
    const exigirAuthConfigurada = () => {
        if (!authDisponivel) {
            throw new Error(
                `Entrar não está disponível nesta instalação. ${motivoDaFaltaDeAuth}`
            );
        }
    };

    // ── Login with email/password ──
    const login = async (email: string, password: string) => {
        exigirAuthConfigurada();
        setIsLoading(true);
        try {
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) {
                throw mapSupabaseError(error, 'LOGIN_FAILED');
            }
            // Session handled by onAuthStateChange
        } catch (err) {
            setIsLoading(false);
            throw err;
        }
    };

    // ── Signup with email/password ──
    const signup = async (email: string, password: string, name: string) => {
        exigirAuthConfigurada();
        setIsLoading(true);
        try {
            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: name },
                },
            });
            if (error) {
                throw mapSupabaseError(error, 'SIGNUP_FAILED');
            }
            // Create profile immediately if user is confirmed
            if (data.user) {
                await ensureProfile(data.user, name);
            }
            // Session handled by onAuthStateChange
        } catch (err) {
            setIsLoading(false);
            throw err;
        }
    };

    // ── Login with Google OAuth ──
    const loginWithGoogle = async () => {
        exigirAuthConfigurada();
        const { error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: `${window.location.origin}/auth/callback`,
            },
        });
        if (error) {
            throw mapSupabaseError(error, 'LOGIN_FAILED');
        }
    };

    // ── Logout ──
    const logout = async () => {
        // Tolerante, nao lanca: logout tambem roda em limpeza de estado, e
        // uma excecao ai vira erro nao tratado sem nada para o usuario fazer.
        if (!authDisponivel) { setUser(null); setToken(null); return; }
        await supabase.auth.signOut();
        setUser(null);
        setToken(null);
        // Clean up legacy localStorage keys
        localStorage.removeItem('gtm-audit-token');
        localStorage.removeItem('gtm-audit-plan');
    };

    // ── Refresh profile (called by AdminPlanTesting after plan changes) ──
    const refreshProfile = async () => {
        if (!authDisponivel) return;
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
            await handleSession(session);
        }
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isLoading,
            login,
            signup,
            loginWithGoogle,
            logout,
            refreshProfile,
            isAuthenticated: !!user,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

// ── Hook ──
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

// ── Map Supabase errors to AuthRequestError ──
function mapSupabaseError(error: AuthError, fallbackCode: AuthErrorCode): AuthRequestError {
    const msg = error.message || '';
    const lower = msg.toLowerCase();

    if (lower.includes('already registered') || lower.includes('already been registered')) {
        return new AuthRequestError(msg, 'EMAIL_ALREADY_REGISTERED', 409);
    }
    if (lower.includes('invalid login') || lower.includes('invalid email or password')) {
        return new AuthRequestError('Email ou senha incorretos.', 'LOGIN_FAILED', 401);
    }
    if (lower.includes('password') && lower.includes('short')) {
        return new AuthRequestError(msg, 'PASSWORD_TOO_SHORT', 422);
    }

    return new AuthRequestError(msg || 'Erro de autenticação', fallbackCode, error.status || 400);
}

export default AuthProvider;
