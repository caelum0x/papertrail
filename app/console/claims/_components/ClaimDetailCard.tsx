import type { ClaimDto } from "@/components/claims/api";

// Card showing the claim text and its metadata (created/updated, project, cited
// source). Pure presentational.

export function ClaimDetailCard({ claim }: { claim: ClaimDto }) {
  return (
    <div className="mt-4 rounded-lg border border-ink/15 bg-white p-5">
      <p className="text-sm leading-relaxed text-ink/80">{claim.text}</p>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        <div>
          <dt className="text-ink/40">Created</dt>
          <dd className="text-ink/70">
            {new Date(claim.created_at).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt className="text-ink/40">Last updated</dt>
          <dd className="text-ink/70">
            {new Date(claim.updated_at).toLocaleString()}
          </dd>
        </div>
        {claim.project_id ? (
          <div>
            <dt className="text-ink/40">Project</dt>
            <dd className="text-ink/70">{claim.project_id}</dd>
          </div>
        ) : null}
        {claim.cited_source_url ? (
          <div className="sm:col-span-2">
            <dt className="text-ink/40">Cited source</dt>
            <dd>
              <a
                href={claim.cited_source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline break-all"
              >
                {claim.cited_source_url}
              </a>
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}
