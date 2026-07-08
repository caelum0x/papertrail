import type { ScienceMessage } from "@/lib/science/clientTypes";
import { ArtifactList } from "./ArtifactList";

// The conversation thread: an empty state or a list of message bubbles.

function MessageBubble({ message }: { message: ScienceMessage }) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        message.role === "assistant"
          ? "border-ink/15 bg-white"
          : "border-accent/20 bg-accent/5"
      }`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-ink/40">
        {message.role}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-ink/80">
        {message.content}
      </p>
      {message.role === "assistant" ? (
        <ArtifactList message={message} />
      ) : null}
    </div>
  );
}

function MessageEmptyState() {
  return (
    <div className="bg-white border border-ink/15 rounded-lg p-6 text-center">
      <p className="text-sm text-ink/60">No messages yet.</p>
      <p className="mt-1 text-sm text-ink/40">
        Ask the assistant to help frame a literature review or find a primary
        source.
      </p>
    </div>
  );
}

export function MessageThread({ messages }: { messages: ScienceMessage[] }) {
  return (
    <div className="mt-5 space-y-3">
      {messages.length === 0 ? (
        <MessageEmptyState />
      ) : (
        messages.map((m) => <MessageBubble key={m.id} message={m} />)
      )}
    </div>
  );
}
