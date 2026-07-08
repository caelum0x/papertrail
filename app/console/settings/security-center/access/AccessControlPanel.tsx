"use client";

import { useRef } from "react";
import { AddIpForm } from "@/components/security/AddIpForm";
import {
  IpAllowlistTable,
  type IpAllowlistTableHandle,
} from "@/components/security/IpAllowlistTable";

// Client coordinator for the access page: wires AddIpForm to the allowlist
// table so a newly-added entry appears immediately without a full refetch.
// Colocated with the route since it only orchestrates this page's components.

export function AccessControlPanel() {
  const tableRef = useRef<IpAllowlistTableHandle>(null);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-medium text-ink/70">Add allowed network</h2>
        <p className="mt-1 mb-3 text-sm text-ink/40">
          Restrict access to specific CIDR ranges. Leave the allowlist empty to
          allow access from any IP.
        </p>
        <AddIpForm onAdded={(entry) => tableRef.current?.prepend(entry)} />
      </div>

      <div>
        <h2 className="text-sm font-medium text-ink/70">Allowlist</h2>
        <div className="mt-3">
          <IpAllowlistTable ref={tableRef} />
        </div>
      </div>
    </div>
  );
}
