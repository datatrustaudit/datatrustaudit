import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

export interface User {
    id: string | number;
    email: string;
    name: string;
    plan: 'free' | 'pro' | 'premium' | string;
}

interface AuthContextType {
    user: User | null;
    token: string | null;
    isLoading: boolean;
    login: (email: string, password: string) => Promise<void>;
    signup: (email: string, password: string, name: string) => Promise<void>;
    logout: () => void;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'gtm-audit-token';

export const AuthProvider = ({ children }: { children: ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const loadUser = async (authToken: string) => {
        try {
            const res = await fetch('/api/auth/me', {
                headers: { 'Authorization': `Bearer ${authToken}` }
            });
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
                setToken(authToken);
            } else {
                localStorage.removeItem(TOKEN_KEY);
                setToken(null);
                setUser(null);
            }
        } catch (e) {
            console.error('Failed to load user', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        const savedToken = localStorage.getItem(TOKEN_KEY);
        if (savedToken) {
            loadUser(savedToken);
        } else {
            setIsLoading(false);
        }
    }, []);

    const login = async (email: string, password: string) => {
        setIsLoading(true);
        try {
            const formData = new URLSearchParams();
            formData.append('username', email); // OAuth2 expects username
            formData.append('password', password);

            const res = await fetch('/api/auth/token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: formData
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || 'Falha no login');
            }

            const data = await res.json();
            localStorage.setItem(TOKEN_KEY, data.access_token);
            await loadUser(data.access_token);
        } finally {
            setIsLoading(false);
        }
    };

    const signup = async (email: string, password: string, name: string) => {
        setIsLoading(true);
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ email, password, name })
            });

            if (!res.ok) {
                const error = await res.json();
                throw new Error(error.detail || 'Falha no cadastro');
            }

            // Realiza login automaticamente após cadastro
            await login(email, password);
        } finally {
            setIsLoading(false);
        }
    };

    const logout = () => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
    };

    return (
        <AuthContext.Provider value={{
            user,
            token,
            isLoading,
            login,
            signup,
            logout,
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
