import { useState, type FormEvent } from 'react';
import api from '@/utils/api';
import { getSupabaseClient } from '@/auth/supabase';
import { installAuthSession, type AuthSession } from '@/auth/session';

export type AuthMode = 'login' | 'register';

export function useAuthForm() {
    const [mode, setMode] = useState<AuthMode>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [notice, setNotice] = useState('');

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        if (!email.trim() || !password) return;
        setLoading(true);
        setNotice('');
        try {
            const supabase = getSupabaseClient();
            const result =
                mode === 'login'
                    ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
                    : await supabase.auth.signUp({
                          email: email.trim(),
                          password,
                          options: { emailRedirectTo: window.location.origin },
                      });
            if (result.error) throw result.error;
            if (!result.data.session) {
                setPassword('');
                setNotice('注册成功，请检查邮箱并完成验证，然后登录。');
                return;
            }
            const response = await api.post<AuthSession>('/auth/supabase/exchange', {
                access_token: result.data.session.access_token,
            });
            const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
            if (signOutError) throw signOutError;
            installAuthSession(response.data);
            setPassword('');
        } catch (error: unknown) {
            setNotice(error instanceof Error ? error.message : '认证失败，请检查邮箱和密码');
        } finally {
            setLoading(false);
        }
    };

    return {
        mode,
        toggleMode: () => setMode((current) => (current === 'login' ? 'register' : 'login')),
        email,
        setEmail,
        password,
        setPassword,
        loading,
        notice,
        submit,
    };
}
