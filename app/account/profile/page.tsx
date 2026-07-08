import { AccountShell } from "@/components/account/AccountShell";
import { ProfileForm } from "./_components/ProfileForm";

// /account/profile — edit your name, display name, title, and avatar.
export default function ProfilePage() {
  return (
    <AccountShell
      title="Profile"
      description="How you appear to teammates across the workspace."
    >
      <ProfileForm />
    </AccountShell>
  );
}
