import { AccountShell } from "@/components/account/AccountShell";
import { PrefsForm } from "./_components/PrefsForm";

// /account/preferences — personal UI preferences (theme, density, defaults).
export default function PreferencesPage() {
  return (
    <AccountShell
      title="Preferences"
      description="Personalize how PaperTrail looks and behaves for you."
    >
      <PrefsForm />
    </AccountShell>
  );
}
