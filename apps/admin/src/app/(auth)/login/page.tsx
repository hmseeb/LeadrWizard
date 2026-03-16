"use client";

import { useState, useMemo } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { Zap } from "lucide-react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const supabase = useMemo(() => createSupabaseBrowserClient(), []);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      window.location.href = "/";
    }
  }

  async function handleMagicLink() {
    if (!email) {
      setError("Enter your email first");
      return;
    }
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/callback` },
    });

    if (error) {
      setError(error.message);
    } else {
      setMessage("Check your email for a login link!");
    }
    setLoading(false);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.06)_0%,_transparent_70%)]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600/15 shadow-glow">
            <Zap className="h-6 w-6 text-brand-400" />
          </div>
          <h1 className="mt-4 font-display text-center text-2xl font-bold tracking-tight text-zinc-50">
            LeadrWizard
          </h1>
          <p className="mt-1 text-center text-sm text-zinc-400">
            Sign in to your admin dashboard
          </p>
        </div>

        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <div className="rounded-xl border border-zinc-800 bg-surface p-6 shadow-card">
            {error && (
              <div className="alert-error mb-4">
                {error}
              </div>
            )}
            {message && (
              <div className="alert-success mb-4">
                {message}
              </div>
            )}

            <div>
              <label className="label">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                placeholder="you@company.com"
                required
              />
            </div>

            <div className="mt-4">
              <label className="label">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary mt-5 w-full"
            >
              {loading ? "Signing in..." : "Sign In"}
            </button>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <button
              type="button"
              onClick={handleMagicLink}
              disabled={loading}
              className="btn-ghost w-full"
            >
              Send Magic Link
            </button>

            <button
              type="button"
              onClick={async () => {
                if (!email) {
                  setError("Enter your email first");
                  return;
                }
                setLoading(true);
                setError(null);
                const { error } = await supabase.auth.resetPasswordForEmail(email, {
                  redirectTo: `${window.location.origin}/callback`,
                });
                if (error) {
                  setError(error.message);
                } else {
                  setMessage("Check your email for a password reset link!");
                }
                setLoading(false);
              }}
              disabled={loading}
              className="btn-ghost w-full text-zinc-500 hover:text-brand-400"
            >
              Forgot password?
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
