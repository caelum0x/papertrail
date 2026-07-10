import type { DataChatTurn } from "./types";
import { ToolTracePills } from "./ToolTracePills";
import { CitationChips } from "./CitationChips";

// One chat turn. User turns are right-aligned accent bubbles; assistant turns are
// left-aligned cards that also render the tool trace (how the answer was built from
// the org's data) and the citation trail (the org's own reports/sources/claims it's
// grounded in).

interface MessageBubbleProps {
  turn: DataChatTurn;
}

export function MessageBubble({ turn }: MessageBubbleProps) {
  if (turn.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg rounded-br-sm bg-accent px-3 py-2 text-sm text-white">
          {turn.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg rounded-bl-sm border border-ink/15 bg-white px-3 py-2">
        <p className="whitespace-pre-wrap text-sm text-ink/80">{turn.content}</p>
        {turn.toolTrace ? <ToolTracePills trace={turn.toolTrace} /> : null}
        {turn.citations ? <CitationChips citations={turn.citations} /> : null}
      </div>
    </div>
  );
}
