"use client";

import { useEffect, useState } from "react";
import { fetchMembers, type OrgMember } from "@/components/signatures/api";
import { LoadingState, ErrorState } from "@/components/signatures/ui";

interface SignerPickerProps {
  // Ordered list of selected user ids (order is the signing order).
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

// Lets the author pick org members as signers and control their signing order.
// Loads members from the shared /api/members endpoint. Selected signers are
// ordered by pick order; the first selected signs first.
export function SignerPicker({ selected, onChange, disabled }: SignerPickerProps) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const result = await fetchMembers();
      if (cancelled) return;
      if (result.error) {
        setError(result.error);
        setMembers([]);
      } else {
        setMembers(result.data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(userId: string) {
    if (selected.includes(userId)) {
      onChange(selected.filter((id) => id !== userId));
    } else {
      onChange([...selected, userId]);
    }
  }

  function move(userId: string, direction: -1 | 1) {
    const idx = selected.indexOf(userId);
    const swap = idx + direction;
    if (idx < 0 || swap < 0 || swap >= selected.length) return;
    const next = [...selected];
    [next[idx], next[swap]] = [next[swap], next[idx]];
    onChange(next);
  }

  const byId = new Map(members.map((m) => [m.userId, m]));

  if (loading) return <LoadingState label="Loading members…" />;
  if (error) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      {selected.length > 0 ? (
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
            Signing order
          </p>
          <ol className="mt-2 space-y-1.5">
            {selected.map((userId, i) => {
              const m = byId.get(userId);
              return (
                <li
                  key={userId}
                  className="flex items-center justify-between rounded-md border border-ink/10 bg-paper px-3 py-2 text-sm"
                >
                  <span className="text-ink/70">
                    <span className="mr-2 font-mono text-xs text-ink/40">
                      {i + 1}.
                    </span>
                    {m?.name || m?.email || userId.slice(0, 8)}
                  </span>
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => move(userId, -1)}
                      disabled={disabled || i === 0}
                      className="rounded border border-ink/10 bg-white px-1.5 py-0.5 text-xs text-ink/60 hover:bg-paper disabled:opacity-30"
                      aria-label="Move up"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => move(userId, 1)}
                      disabled={disabled || i === selected.length - 1}
                      className="rounded border border-ink/10 bg-white px-1.5 py-0.5 text-xs text-ink/60 hover:bg-paper disabled:opacity-30"
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => toggle(userId)}
                      disabled={disabled}
                      className="rounded border border-ink/10 bg-white px-1.5 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-30"
                      aria-label="Remove signer"
                    >
                      ✕
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : (
        <p className="text-sm text-ink/40">
          No signers selected yet. Pick members below in signing order.
        </p>
      )}

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
          Members
        </p>
        <div className="mt-2 max-h-64 space-y-1 overflow-y-auto rounded-md border border-ink/10">
          {members.length === 0 ? (
            <p className="p-3 text-sm text-ink/40">No members found.</p>
          ) : (
            members.map((m) => {
              const checked = selected.includes(m.userId);
              return (
                <label
                  key={m.userId}
                  className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-paper"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(m.userId)}
                  />
                  <span className="text-ink/70">{m.name || m.email}</span>
                  {m.name ? (
                    <span className="text-xs text-ink/40">{m.email}</span>
                  ) : null}
                  <span className="ml-auto text-[11px] uppercase tracking-wide text-ink/30">
                    {m.role}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
