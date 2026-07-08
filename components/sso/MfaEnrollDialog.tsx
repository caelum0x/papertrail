"use client";

import { useCallback, useState } from "react";
import type { MfaEnrollment, MfaFactor } from "@/lib/sso/types";
import { enrollMfa, verifyMfa } from "@/components/sso/api";

// TOTP enrollment dialog: a two-step flow. Step 1 calls enroll and shows the
// secret + otpauth URI; step 2 verifies a 6-digit code. On success it returns
// the verified factor to the parent. Handles its own loading/error states.

interface MfaEnrollDialogProps {
  onClose: () => void;
  onEnrolled: (factor: MfaFactor) => void;
}

export function MfaEnrollDialog({ onClose, onEnrolled }: MfaEnrollDialogProps) {
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [starting, setStarting] = useState(false);
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onStart = useCallback(async () => {
    setStarting(true);
    setError(null);
    try {
      setEnrollment(await enrollMfa());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start enrollment.");
    } finally {
      setStarting(false);
    }
  }, []);

  const onVerify = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!enrollment) return;
      setError(null);
      setVerifying(true);
      try {
        const factor = await verifyMfa(enrollment.factor.id, code.trim());
        onEnrolled(factor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Verification failed.");
      } finally {
        setVerifying(false);
      }
    },
    [enrollment, code, onEnrolled]
  );

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-ink/30 p-4">
      <div className="w-full max-w-md bg-white border border-ink/15 rounded-lg p-5">
        <h3 className="text-sm font-medium text-ink/80">
          Set up authenticator app
        </h3>

        {!enrollment ? (
          <>
            <p className="mt-1 text-xs text-ink/50">
              Use an app like 1Password, Authy, or Google Authenticator. We&rsquo;ll
              show you a secret to add, then confirm a code.
            </p>
            {error ? (
              <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-ink/60 hover:text-ink/80"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onStart}
                disabled={starting}
                className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
              >
                {starting ? "Starting…" : "Begin"}
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={onVerify}>
            <p className="mt-1 text-xs text-ink/50">
              Add this secret to your authenticator app, then enter the 6-digit
              code it shows.
            </p>
            <div className="mt-3">
              <p className="text-xs text-ink/60">Secret key</p>
              <pre className="mt-1 text-xs bg-paper border border-ink/10 rounded p-2 overflow-x-auto select-all">
                {enrollment.secret}
              </pre>
            </div>
            <div className="mt-2">
              <p className="text-xs text-ink/60">otpauth URI</p>
              <pre className="mt-1 text-[11px] bg-paper border border-ink/10 rounded p-2 overflow-x-auto select-all">
                {enrollment.otpauthUri}
              </pre>
            </div>

            <label htmlFor="mfa-code" className="mt-4 block text-xs text-ink/60">
              6-digit code
            </label>
            <input
              id="mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456"
              className="mt-1 w-full text-sm tracking-widest border border-ink/15 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />

            {error ? (
              <p className="mt-3 text-sm text-red-600">{error}</p>
            ) : null}

            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-ink/60 hover:text-ink/80"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={verifying || code.length !== 6}
                className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
              >
                {verifying ? "Verifying…" : "Verify & enable"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
