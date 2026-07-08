import { AccountOverview } from "./_components/AccountOverview";

// /account — the account center overview. Client component because it fetches the
// current user's profile / security / token summary on mount.
export default function AccountPage() {
  return <AccountOverview />;
}
