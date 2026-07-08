"use client";

// Dedicated "open a new ticket" page. Wraps the shared NewTicketForm and routes
// to the created ticket on success.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ModuleHeader } from "@/components/help/ModuleHeader";
import { NewTicketForm } from "@/components/help/NewTicketForm";

export default function NewTicketPage() {
  const router = useRouter();
  return (
    <div>
      <Link href="/console/help/tickets" className="text-sm text-accent">
        ← Back to tickets
      </Link>
      <div className="mt-4">
        <ModuleHeader
          title="New support ticket"
          subtitle="Describe your issue and we will follow up in the thread."
        />
        <div className="mt-6 max-w-2xl">
          <NewTicketForm
            onCreated={(t) => router.push(`/console/help/tickets/${t.id}`)}
            onCancel={() => router.push("/console/help/tickets")}
          />
        </div>
      </div>
    </div>
  );
}
