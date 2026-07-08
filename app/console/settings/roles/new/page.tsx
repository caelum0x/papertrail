import { ModuleHeader } from "@/components/rbac/ModuleHeader";
import { RoleEditor } from "@/components/rbac/RoleEditor";

// FORM sub-page: create a new custom role.
export default function NewRolePage() {
  return (
    <div className="max-w-4xl">
      <ModuleHeader
        title="New role"
        subtitle="Name the role and grant the permissions it should include."
        backHref="/console/settings/roles"
        backLabel="Back to roles"
      />
      <RoleEditor />
    </div>
  );
}
