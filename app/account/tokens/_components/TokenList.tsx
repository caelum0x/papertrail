"use client";

import { useCallback, useEffect, useState } from "react";
import type { PersonalToken } from "@/lib/account/types";
import { Card } from "@/components/account/Card";
import { Pagination } from "@/components/account/Pagination";
import { Button } from "@/components/account/fields";
import { LoadingRows, EmptyState, ErrorState } from "@/components/account/states";
import { fetchTokens, revokeToken } from "../../_components/api";
import { TokenRow } from "./TokenRow";
import { CreateTokenDialog } from "./CreateTokenDialog";

const PAGE_SIZE = 10;

// Personal access token manager (TokenList + CreateTokenDialog). Lists the user's
// tokens with pagination, opens the create dialog, and revokes tokens — reloading
// after each mutation so the list and pager stay consistent.
export function TokenList() {
  const [items, setItems] = useState<PersonalToken[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetchTokens(page, PAGE_SIZE);
    if (res.error) {
      setError(res.error);
      setItems([]);
      setTotal(0);
    } else {
      setItems(res.data ?? []);
      setTotal(res.total);
    }
    setLoading(false);
  }, [page]);

  useEffect(() => {
    load();
  }, [load]);

  const onRevoke = async (id: string) => {
    setRevokingId(id);
    const res = await revokeToken(id);
    setRevokingId(null);
    if (res.error) {
      setError(res.error);
      return;
    }
    if (items.length === 1 && page > 1) {
      setPage((p) => p - 1);
    } else {
      load();
    }
  };

  const onCreated = () => {
    // Jump to the first page so the newest token is visible after the dialog's
    // one-time reveal step closes.
    if (page !== 1) setPage(1);
    else load();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <Card
        title="Personal access tokens"
        description="Tokens authenticate CLI and scripts as you. Treat them like passwords."
        footer={
          <div className="flex justify-end">
            <Button type="button" onClick={() => setDialogOpen(true)}>
              Create token
            </Button>
          </div>
        }
      >
        {loading ? (
          <LoadingRows rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : items.length === 0 ? (
          <EmptyState
            title="No access tokens yet."
            hint="Create one to use the API from a script or the CLI."
            action={
              <Button type="button" onClick={() => setDialogOpen(true)}>
                Create your first token
              </Button>
            }
          />
        ) : (
          <>
            <ul className="-mx-5 divide-y divide-ink/10">
              {items.map((t) => (
                <TokenRow
                  key={t.id}
                  token={t}
                  revoking={revokingId === t.id}
                  onRevoke={onRevoke}
                />
              ))}
            </ul>
            <div className="-mx-5 -mb-4">
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                onPrev={() => setPage((p) => Math.max(1, p - 1))}
                onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
              />
            </div>
          </>
        )}
      </Card>

      <CreateTokenDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={onCreated}
      />
    </>
  );
}
