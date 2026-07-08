"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { IntegrationConfigForm } from "../_components/IntegrationConfigForm";
import { EventLog } from "../_components/EventLog";
import { useIntegrationDetail } from "../_components/useIntegrationDetail";

// Integration detail: configure a connector's name/config, toggle status, send
// a test event, and review its recent event log. Admin+ only.
export default function IntegrationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const {
    canManage,
    roleLoading,
    integration,
    provider,
    events,
    loading,
    error,
    name,
    setName,
    form,
    setField,
    saving,
    saveError,
    saved,
    test,
    testing,
    save,
    toggleStatus,
    sendTest,
  } = useIntegrationDetail(id);

  if (!roleLoading && !canManage) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Integration</h1>
        <p className="mt-4 text-sm text-ink/60">
          You need an admin or owner role to configure integrations.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-ink/80">
          {integration ? integration.name : "Integration"}
        </h1>
        <div className="flex items-center gap-4 shrink-0">
          {integration ? (
            <Link
              href={`/console/integrations/${integration.id}/activity`}
              className="text-sm text-ink/60 hover:text-accent"
            >
              Activity
            </Link>
          ) : null}
          <Link
            href="/console/integrations"
            className="text-sm text-ink/60 hover:text-accent"
          >
            ← Integrations
          </Link>
        </div>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/40">Loading integration...</p>
      ) : error ? (
        <p className="mt-6 text-sm text-red-600">{error}</p>
      ) : !integration ? (
        <p className="mt-6 text-sm text-ink/40">Integration not found.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink/40">
            {provider?.description ?? integration.provider} ·{" "}
            {integration.status === "active" ? (
              <span className="text-ink/60">active</span>
            ) : (
              <span className="text-red-600">disabled</span>
            )}
          </p>

          <IntegrationConfigForm
            integration={integration}
            provider={provider}
            name={name}
            onNameChange={setName}
            form={form}
            onFieldChange={setField}
            saving={saving}
            saveError={saveError}
            saved={saved}
            testing={testing}
            test={test}
            onSave={save}
            onTest={sendTest}
            onToggleStatus={toggleStatus}
          />

          <EventLog events={events} />
        </>
      )}
    </div>
  );
}
