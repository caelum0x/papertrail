import { ModuleHeader } from "@/components/rbac/ModuleHeader";
import { RolesList } from "@/components/rbac/RolesList";
import { PermissionMatrix } from "@/components/rbac/PermissionMatrix";

// LIST view: custom roles table + the read-only permission coverage matrix.
export default function RolesPage() {
  return (
    <div className="max-w-5xl">
      <ModuleHeader
        title="Roles & permissions"
        subtitle="Define custom roles as bundles of fine-grained resource permissions."
        backHref="/console/settings"
        backLabel="Back to settings"
      />
      <div className="space-y-8">
        <RolesList />
        <PermissionMatrix />
      </div>
    </div>
  );
}
