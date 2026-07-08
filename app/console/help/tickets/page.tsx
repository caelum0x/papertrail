"use client";

// Support tickets list page. Composes the header, filters, list, pagination, and
// an inline NewTicketForm (toggled open). Owns filter + pagination state.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  apiGet,
  type SupportTicketDto,
  type TicketStatus,
  type TicketPriority,
} from "../api";
import { ModuleHeader } from "@/components/help/ModuleHeader";
import { TicketFilters } from "@/components/help/TicketFilters";
import { TicketList } from "@/components/help/TicketList";
import { NewTicketForm } from "@/components/help/NewTicketForm";
import { Pagination } from "@/components/help/Pagination";

const PAGE_LIMIT = 20;

export default function TicketsPage() {
  const router = useRouter();

  const [status, setStatus] = useState<TicketStatus | null>(null);
  const [priority, setPriority] = useState<TicketPriority | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);

  const [tickets, setTickets] = useState<SupportTicketDto[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_LIMIT),
    });
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);
    if (search) params.set("search", search);

    const res = await apiGet<SupportTicketDto[]>(`/api/support/tickets?${params}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load tickets.");
      setLoading(false);
      return;
    }
    setTickets(res.data);
    setTotal(res.meta?.total ?? res.data.length);
    setLoading(false);
  }, [page, status, priority, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(total / PAGE_LIMIT)),
    [total]
  );

  return (
    <div>
      <ModuleHeader
        title="Support tickets"
        subtitle="Track and respond to support requests for your organization."
        action={
          <div className="flex items-center gap-2">
            <Link href="/console/help" className="text-sm text-ink/60 hover:text-ink/80">
              Help center
            </Link>
            <button
              onClick={() => setShowForm((s) => !s)}
              className="text-sm bg-accent text-white rounded px-3 py-2 hover:opacity-90"
            >
              {showForm ? "Close" : "New ticket"}
            </button>
          </div>
        }
      />

      {showForm ? (
        <div className="mt-6">
          <NewTicketForm
            onCreated={(t) => router.push(`/console/help/tickets/${t.id}`)}
            onCancel={() => setShowForm(false)}
          />
        </div>
      ) : null}

      <div className="mt-6">
        <TicketFilters
          status={status}
          priority={priority}
          search={searchInput}
          onStatus={(s) => {
            setStatus(s);
            setPage(1);
          }}
          onPriority={(p) => {
            setPriority(p);
            setPage(1);
          }}
          onSearch={setSearchInput}
        />
      </div>

      <div className="mt-4">
        <TicketList
          tickets={tickets}
          loading={loading}
          error={error}
          onRetry={() => void load()}
        />
        {!loading && !error ? (
          <Pagination
            page={page}
            totalPages={totalPages}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
          />
        ) : null}
      </div>
    </div>
  );
}
