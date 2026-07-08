import { AccountShell } from "@/components/account/AccountShell";
import { TokenList } from "./_components/TokenList";

// /account/tokens — create and revoke personal access tokens.
export default function TokensPage() {
  return (
    <AccountShell
      title="Access tokens"
      description="Personal tokens for authenticating the API from scripts and the CLI as you."
    >
      <TokenList />
    </AccountShell>
  );
}
