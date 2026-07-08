"use client";

import { useParams } from "next/navigation";
import { AdminGate } from "@/components/sso/AdminGate";
import { ModuleHeader } from "@/components/sso/ModuleHeader";
import { ConnectionDetail } from "@/components/sso/ConnectionDetail";

// SSO connection detail page. Composes the module header + the ConnectionDetail
// container (DetailHeader + Tabs + config/domain/provisioning panels + side
// panel). Admin+ only.

export default function SsoConnectionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  return (
    <AdminGate title="SSO connections">
      <div className="max-w-4xl space-y-6">
        <ModuleHeader
          title="Connection"
          backHref="/console/settings/sso"
          backLabel="SSO connections"
        />
        {id ? (
          <ConnectionDetail id={id} />
        ) : (
          <p className="text-sm text-red-600">Missing connection id.</p>
        )}
      </div>
    </AdminGate>
  );
}
