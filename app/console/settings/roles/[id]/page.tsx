"use client";

import { useParams } from "next/navigation";
import { ModuleHeader } from "@/components/rbac/ModuleHeader";
import { RoleEditorLoader } from "@/components/rbac/RoleEditorLoader";

// DETAIL/edit sub-page: load an existing role and edit its name + permissions.
export default function EditRolePage() {
  const params = useParams<{ id: string }>();
  const roleId = params?.id;

  return (
    <div className="max-w-4xl">
      <ModuleHeader
        title="Edit role"
        subtitle="Update the role name or adjust which permissions it grants."
        backHref="/console/settings/roles"
        backLabel="Back to roles"
      />
      {roleId ? (
        <RoleEditorLoader roleId={roleId} />
      ) : (
        <div className="text-sm text-red-600">Invalid role id.</div>
      )}
    </div>
  );
}
