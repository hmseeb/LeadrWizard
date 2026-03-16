import { MailCheck } from "lucide-react";

/**
 * Post-checkout success page.
 * Shown after completing Stripe Checkout for a new agency signup.
 * The user cannot log in yet -- they need to click the invite link in their email first.
 * This page is public (no auth required, handled by middleware exclusion in Plan 02).
 */
export default function SignupSuccessPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.06)_0%,_transparent_70%)]">
      <div className="w-full max-w-md text-center">
        <div className="rounded-xl border border-zinc-800 bg-surface p-8 shadow-card">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
            <MailCheck className="h-8 w-8 text-emerald-400" />
          </div>

          <h1 className="mt-6 font-display text-2xl font-bold tracking-tight text-zinc-50">
            You&apos;re all set!
          </h1>

          <p className="mt-3 text-zinc-300">
            We&apos;ve sent a welcome email to your inbox. Click the link in the
            email to set your password and access your new dashboard.
          </p>

          <div className="mt-6 rounded-lg border border-sky-500/20 bg-sky-500/10 p-4 text-left">
            <h3 className="text-sm font-semibold text-sky-300">
              What happens next:
            </h3>
            <ol className="mt-2 list-inside list-decimal space-y-1 text-sm text-sky-400/90">
              <li>Check your email for the invite from LeadrWizard</li>
              <li>Click the link to set your password</li>
              <li>Log in to your dashboard and configure your services</li>
            </ol>
          </div>

          <p className="mt-6 text-xs text-zinc-500">
            Didn&apos;t receive the email? Check your spam folder. The invite
            link expires in 24 hours.
          </p>
        </div>
      </div>
    </div>
  );
}
