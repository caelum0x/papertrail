import { AccountShell } from "@/components/account/AccountShell";
import { PasswordForm } from "./_components/PasswordForm";
import { SessionsList } from "./_components/SessionsList";
import { MfaSummary } from "./_components/MfaSummary";

// /account/security — password, active sessions, and two-factor summary.
export default function SecurityPage() {
  return (
    <AccountShell
      title="Security"
      description="Keep your account secure: change your password, review where you're signed in, and manage two-factor authentication."
    >
      <div className="space-y-6">
        <PasswordForm />
        <MfaSummary />
        <SessionsList />
      </div>
    </AccountShell>
  );
}
