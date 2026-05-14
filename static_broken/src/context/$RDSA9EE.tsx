import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

export interface User {
    id: string | number;
    email: string;
    name: string;
    avatarUrl?: string;
    plan: 'free' | 'pro' | 'full' | string;
    createdAt?: string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
    logout: () => void;
    refreshUser: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'gtm-audit-token';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadUser = useCallback(async (authToken: string) => {
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
                setToken(authToken);
            } else {
                // Token expired or invalid — clean up
                localStorage.removeItem(TOKEN_KEY);
                setToken(null);
                setUser(null);
            }
        } catch (e) {
            console.error('Failed to load user', e);
            // Network error — don't clear token, might be temporary
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
            loadUser(savedToken);
        } else {
            setIsLoading(false);
        }
    }, [loadUser]);

    const login = async (email: string, password: string) => {
        const formData = new URLSearchParams();
        formData.append('username', email.trim().toLowerCase()); // OAuth2 expects username
        formData.append('password', password);

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });

        if (!res.ok) {
            let errorMessage = 'Falha no login';
            try {
                const error = await res.json();
                errorMessage = error.detail || errorMessage;
            } catch {
                // Could not parse JSON error
                if (res.status === 401) {
                    errorMessage = 'Email ou senha incorretos';
                } else if (res.status === 422) {
                    errorMessage = 'Dados inválidos';
                } else {
                    errorMessage = `Erro no servidor (${res.status})`;
                }
            }
            throw new Error(errorMessage);
        }

        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.access_token);
        await loadUser(data.access_token);
    };

    const signup = async (email: string, password: string, name: string) => {
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email: email.trim().toLowerCase(),
                password,
                name: name.trim()
            })
        });

        if (!res.ok) {
            let errorMessage = 'Falha no cadastro';
            try {
                const error = await res.json();
                // Handle Pydantic validation errors (array of detail objects)
                if (Array.isArray(error.detail)) {
                    const msgs = error.detail.map((d: { msg?: string }) => d.msg || '').filter(Boolean);
                    errorMessage = msgs.join('. ') || errorMessage;
                } else {
                    errorMessage = error.detail || errorMessage;
                }
            } catch {
                if (res.status === 400) {
                    errorMessage = 'Email já cadastrado';
                } else if (res.status === 422) {
                    errorMessage = 'Dados inválidos. Verifique email e senha.';
                } else {
                    errorMessage = `Erro no servidor (${res.status})`;
                }
            }
            throw new Error(errorMessage);
        }

        // Register now returns a token directly — auto-login
        const data = await res.json();
        localStorage.setItem(TOKEN_KEY, data.access_token);
        await loadUser(data.access_token);
    };

    const logout = useCallback(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        // Fire and forget server-side logout
        fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    }, []);

    const refreshUser = useCallback(async () => {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
            await loadUser(savedToken);
        }
    }, [loadUser]);

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isLoading,
            login,
            signup,
            logout,
            refreshUser,
            isAuthenticated: !!user,
        }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

export default AuthProvider;
