"use client";

import { useState } from "react";
import type { SignatureRequestDetail } from "@/lib/signatures/types";
import { currentSigner } from "@/lib/signatures/types";
import { ErrorState } from "@/components/signatures/ui";

// MFA methods offered when signing. The value is a human-readable assertion of
// how the signer re-authenticated; it is required by the API and recorded on the
// audit trail + folded into the certificate context.
const MFA_METHODS = [
  { value: "totp", label: "Authenticator app (TOTP)" },
  { value: "webauthn", label: "Security key (WebAuthn)" },
  { value: "sms", label: "SMS one-time code" },
  { value: "email_otp", label: "Email one-time code" },
];

interface SignPanelProps {
  detail: SignatureRequestDetail;
  currentUserId: string | null;
  submitting: boolean;
  actionError: string | null;
  onSign: (mfaMethod: string) => void;
}

// The action panel where the current signer completes their signature. Only
// renders its sign control when it is genuinely this user's turn; otherwise it
// explains the current state.
export function SignPanel({
  detail,
  currentUserId,
  submitting,
  actionError,
  onSign,
}: SignPanelProps) {
  const [mfaMethod, setMfaMethod] = useState<string>(MFA_METHODS[0].value);
  const { request, signers } = detail;

  const active = currentSigner(signers);
  const isMyTurn =
    request.status === "pending" &&
    active !== null &&
    currentUserId !== null &&
    active.userId === currentUserId;

  let message: string | null = null;
  if (request.status === "completed") {
    message = "This request is fully signed and complete.";
  } else if (request.status === "cancelled") {
    message = "This request was cancelled and can no longer be signed.";
  } else if (request.status === "draft") {
    message = "This request has no signers yet.";
  } else if (!active) {
    message = "There are no outstanding signers.";
  } else if (!isMyTurn) {
    const who = active.userName || active.userEmail || "another signer";
    message = `Waiting on ${who} to sign.`;
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Sign</h2>

      {isMyTurn ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-ink/60">
            It's your turn to sign. Choose how you re-authenticated, then sign.
          </p>
          <label className="block">
            <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
              MFA method
            </span>
            <select
              value={mfaMethod}
              onChange={(e) => setMfaMethod(e.target.value)}
              disabled={submitting}
              className="mt-1 w-full rounded-md border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink/70"
            >
              {MFA_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {actionError ? <ErrorState message={actionError} /> : null}
          <button
            onClick={() => onSign(mfaMethod)}
            disabled={submitting}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Signing…" : "Sign now"}
          </button>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink/40">{message}</p>
          {actionError ? (
            <div className="mt-3">
              <ErrorState message={actionError} />
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
