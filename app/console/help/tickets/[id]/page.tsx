"use client";

// Ticket detail page. Fetches the ticket + its message thread, then composes the
// TicketHeader (with editor triage controls), the MessageThread, and the ReplyBox.
// Owns ticket + messages state so child mutations update in place.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  apiGet,
  type SupportTicketDto,
  type TicketMessageDto,
  type TicketDetailDto,
} from "../../api";
import { TicketHeader } from "@/components/help/TicketHeader";
import { MessageThread } from "@/components/help/MessageThread";
import { ReplyBox } from "@/components/help/ReplyBox";
import { EmptyState } from "@/components/help/EmptyState";

// The console layout persists the active user id; fall back to null if absent so
// "isMine" highlighting simply degrades to "not mine".
function currentUserId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem("pt_user_id");
}

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const [ticket, setTicket] = useState<SupportTicketDto | null>(null);
  const [messages, setMessages] = useState<TicketMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    const res = await apiGet<TicketDetailDto>(`/api/support/tickets/${id}`);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load ticket.");
      setTicket(null);
      setLoading(false);
      return;
    }
    setTicket(res.data.ticket);
    setMessages(res.data.messages);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const userId = currentUserId();

  return (
    <div>
      <Link href="/console/help/tickets" className="text-sm text-accent">
        ← Back to tickets
      </Link>

      <div className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/40">Loading ticket...</p>
        ) : error ? (
          <EmptyState
            title={error}
            action={
              <button onClick={() => void load()} className="text-sm text-accent">
                Retry
              </button>
            }
          />
        ) : ticket ? (
          <div className="space-y-6">
            <TicketHeader
              ticket={ticket}
              canManage
              onUpdated={(t) => {
                setTicket(t);
                setActionError(null);
              }}
              onError={setActionError}
            />

            {actionError ? (
              <p className="text-sm text-red-600">{actionError}</p>
            ) : null}

            <section>
              <h2 className="text-sm font-medium text-ink/60 mb-3">
                Conversation
              </h2>
              <MessageThread messages={messages} currentUserId={userId} />
            </section>

            <ReplyBox
              ticketId={ticket.id}
              onPosted={(m) => setMessages((prev) => [...prev, m])}
            />
          </div>
        ) : (
          <EmptyState title="Ticket not found." />
        )}
      </div>
    </div>
  );
}
