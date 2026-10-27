import { useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Field, FormError } from '@/components/ui';
import { Logo } from '@/components/Logo';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[18%] h-72 w-72 -translate-x-1/2 rounded-full bg-accent/20 blur-[110px] dark:bg-accent/25"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-[60%] top-[38%] h-56 w-56 -translate-x-1/2 rounded-full bg-income/10 blur-[110px]"
      />
      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo compact />
          <div>
            <p className="text-xl font-semibold tracking-tight">Financeiro Pessoal</p>
            <p className="mt-1 text-sm text-muted">Saiba quanto você pode gastar, sem surpresas.</p>
          </div>
        </div>
        <div className="rounded-3xl border border-line/70 bg-surface/90 p-7 shadow-2xl backdrop-blur">
          <h1 className="mb-5 text-lg font-semibold tracking-tight">{title}</h1>
          {children}
        </div>
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Mensagens do Auth sem revelar se um e-mail existe. Para erros não previstos,
 * o texto técnico do serviço de autenticação é anexado para facilitar o diagnóstico
 * (ele não contém dados de outros usuários).
 */
function authMessage(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'E-mail ou senha incorretos.';
  if (/email not confirmed/i.test(message)) return 'Confirme seu e-mail pelo link enviado antes de entrar.';
  if (/rate limit|too many/i.test(message)) {
    return 'Limite de envio de e-mails do Supabase atingido. Aguarde ou configure um SMTP próprio / desative a confirmação de e-mail.';
  }
  if (/error sending|sending (confirmation|recovery|magic)|smtp|not authorized/i.test(message)) {
    return 'O Supabase não conseguiu enviar o e-mail de confirmação. Configure um SMTP próprio ou desative "Confirm email" em Authentication.';
  }
  if (/database error/i.test(message)) return 'Erro no banco ao criar o usuário. Verifique se a migração foi aplicada.';
  if (/invalid api key|no api key/i.test(message)) return 'Chave do Supabase inválida. Confira VITE_SUPABASE_ANON_KEY na hospedagem.';
  if (/signups not allowed|signup.*disabled/i.test(message)) return 'Novos cadastros estão desativados no Supabase.';
  if (/password/i.test(message) && /(short|least|weak)/i.test(message)) return 'Senha fraca: use ao menos 8 caracteres.';
  if (/fetch|network/i.test(message)) return 'Falha de conexão com o Supabase. Confira VITE_SUPABASE_URL.';
  return `Não foi possível concluir. Detalhe técnico: ${message.slice(0, 200)}`;
}

export function LoginPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (session) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setPending(false);
    if (error) setError(authMessage(error.message));
  }

  return (
    <AuthShell title="Entrar" footer={<>Não tem conta? <Link className="font-semibold text-accent" to="/cadastro">Criar conta</Link></>}>
      <form onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        <Field label="E-mail" htmlFor="li-email">
          <input id="li-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" htmlFor="li-pw">
          <input id="li-pw" type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn-primary mt-2 h-11" disabled={pending}>{pending ? 'Entrando…' : 'Entrar'}</button>
        <Link to="/recuperar-senha" className="text-center text-sm text-accent">Esqueci minha senha</Link>
      </form>
    </AuthShell>
  );
}

export function SignUpPage() {
  const { session } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  if (session) return <Navigate to="/" replace />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: window.location.origin },
    });
    setPending(false);
    if (error) setError(authMessage(error.message));
    else setDone(true);
  }

  if (done) {
    return (
      <AuthShell title="Verifique seu e-mail" footer={<Link className="font-semibold text-accent" to="/entrar">Voltar para o login</Link>}>
        <p className="text-sm text-muted">
          Se o cadastro for aceito, você receberá um link de confirmação em <strong className="text-fg">{email}</strong>. Depois
          de confirmar, entre com sua senha.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Criar conta" footer={<>Já tem conta? <Link className="font-semibold text-accent" to="/entrar">Entrar</Link></>}>
      <form onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        <Field label="Nome (opcional)" htmlFor="su-name">
          <input id="su-name" className="input" maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="E-mail" htmlFor="su-email">
          <input id="su-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Senha" htmlFor="su-pw" hint="Mínimo de 8 caracteres.">
          <input id="su-pw" type="password" autoComplete="new-password" required minLength={8} className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn-primary mt-2 h-11" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/redefinir-senha`,
    });
    setPending(false);
    if (error && /rate|fetch|network/i.test(error.message)) setError(authMessage(error.message));
    else setSent(true); // não revela se o e-mail está cadastrado
  }

  return (
    <AuthShell title="Recuperar senha" footer={<Link className="font-semibold text-accent" to="/entrar">Voltar para o login</Link>}>
      {sent ? (
        <p className="text-sm text-muted">Se houver uma conta com este e-mail, enviaremos um link para redefinir a senha.</p>
      ) : (
        <form onSubmit={submit} className="grid gap-4">
          <FormError message={error} />
          <Field label="E-mail" htmlFor="fp-email">
            <input id="fp-email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <button className="btn-primary" disabled={pending}>{pending ? 'Enviando…' : 'Enviar link'}</button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (loading) return null;
  if (!session) {
    return (
      <AuthShell title="Link inválido ou expirado" footer={<Link className="font-semibold text-accent" to="/recuperar-senha">Solicitar novo link</Link>}>
        <p className="text-sm text-muted">Abra o link mais recente enviado para o seu e-mail.</p>
      </AuthShell>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) return setError('A senha deve ter pelo menos 8 caracteres.');
    setPending(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPending(false);
    if (error) return setError(authMessage(error.message));
    navigate('/', { replace: true });
  }

  return (
    <AuthShell title="Definir nova senha">
      <form onSubmit={submit} className="grid gap-4">
        <FormError message={error} />
        <Field label="Nova senha" htmlFor="rp-pw" hint="Mínimo de 8 caracteres.">
          <input id="rp-pw" type="password" autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button className="btn-primary" disabled={pending}>{pending ? 'Salvando…' : 'Salvar senha'}</button>
      </form>
    </AuthShell>
  );
}

export function SetupRequiredPage() {
  return (
    <AuthShell title="Configuração necessária">
      <div className="space-y-3 text-sm text-muted">
        <p>O aplicativo ainda não está conectado a um banco de dados. Para funcionar ele precisa de um projeto Supabase:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Crie um projeto em supabase.com.</li>
          <li>Aplique as migrações em <code className="text-fg">supabase/migrations</code>.</li>
          <li>
            Defina <code className="text-fg">VITE_SUPABASE_URL</code> e <code className="text-fg">VITE_SUPABASE_ANON_KEY</code> e
            gere o build novamente.
          </li>
        </ol>
        <p>Veja o README para o passo a passo.</p>
      </div>
    </AuthShell>
  );
}
