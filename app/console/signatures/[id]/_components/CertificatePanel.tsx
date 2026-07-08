"use client";

import type { SignatureCertificate } from "@/lib/signatures/types";
import { HashChip, formatDateTime } from "@/components/signatures/ui";

interface CertificatePanelProps {
  certificate: SignatureCertificate | null;
  isCompleted: boolean;
}

// Shows the tamper-evident completion certificate once the request is fully
// signed. Before completion it explains that a certificate is pending.
export function CertificatePanel({
  certificate,
  isCompleted,
}: CertificatePanelProps) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Certificate</h2>

      {certificate ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="text-ink/60">
            Issued {formatDateTime(certificate.issuedAt)}. This digest is a
            deterministic hash of the request and its ordered signer trail — any
            tampering changes it.
          </p>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-ink/40">
              Certificate hash (SHA-256)
            </span>
            <div className="mt-1">
              <HashChip value={certificate.certHash} />
            </div>
          </div>
        </div>
      ) : isCompleted ? (
        <p className="mt-2 text-sm text-ink/40">
          This request is complete, but no certificate was found.
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink/40">
          A certificate is issued automatically once every signer has signed.
        </p>
      )}
    </div>
  );
}
