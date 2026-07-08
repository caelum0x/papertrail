"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getJson,
  sendJson,
  displayName,
  initials,
  timeAgo,
  segmentBody,
  type CollabEntityType,
  type CommentView,
} from "./client";

interface CommentThreadProps {
  entityType: CollabEntityType;
  entityId: string;
  // The current user's id, so the thread can show edit/delete affordances only
  // on the viewer's own comments. Optional: omit to render read-only.
  currentUserId?: string;
  // Whether the current user may post/edit/delete (editor+). Defaults to true;
  // pass false to render a read-only thread for viewers.
  canWrite?: boolean;
}

interface TreeNode {
  comment: CommentView;
  replies: CommentView[];
}

// Groups a flat comment list into top-level comments with their direct replies.
function buildTree(comments: CommentView[]): TreeNode[] {
  const roots: CommentView[] = [];
  const repliesByParent = new Map<string, CommentView[]>();
  for (const c of comments) {
    if (c.parentId) {
      const list = repliesByParent.get(c.parentId) ?? [];
      list.push(c);
      repliesByParent.set(c.parentId, list);
    } else {
      roots.push(c);
    }
  }
  return roots.map((comment) => ({
    comment,
    replies: repliesByParent.get(comment.id) ?? [],
  }));
}

function Body({ body }: { body: string }) {
  const segments = useMemo(() => segmentBody(body), [body]);
  return (
    <span className="whitespace-pre-wrap break-words">
      {segments.map((seg, i) =>
        seg.mention ? (
          <span key={i} className="text-accent font-medium">
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </span>
  );
}

// A reusable discussion thread for any entity (claim, document, verification,
// review). Loads its own comments, supports posting, one level of replies, and
// author-scoped edit/delete. Renders loading / empty / error states.
export default function CommentThread({
  entityType,
  entityId,
  currentUserId,
  canWrite = true,
}: CommentThreadProps) {
  const [comments, setComments] = useState<CommentView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  const [editing, setEditing] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<CommentView[]>(
      `/api/comments?entity_type=${encodeURIComponent(
        entityType
      )}&entity_id=${encodeURIComponent(entityId)}`
    );
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load comments.");
      return;
    }
    setComments(res.data);
  }, [entityType, entityId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = useCallback(
    async (body: string, parentId: string | null) => {
      const trimmed = body.trim();
      if (!trimmed) return false;
      setPosting(true);
      setPostError(null);
      const res = await sendJson<CommentView>("/api/comments", "POST", {
        entityType,
        entityId,
        parentId: parentId ?? undefined,
        body: trimmed,
      });
      setPosting(false);
      if (!res.success || !res.data) {
        setPostError(res.error ?? "Failed to post comment.");
        return false;
      }
      setComments((prev) => [...prev, res.data as CommentView]);
      return true;
    },
    [entityType, entityId]
  );

  const onSubmit = useCallback(async () => {
    if (await post(draft, null)) setDraft("");
  }, [draft, post]);

  const onSubmitReply = useCallback(
    async (parentId: string) => {
      if (await post(replyDraft, parentId)) {
        setReplyDraft("");
        setReplyTo(null);
      }
    },
    [replyDraft, post]
  );

  const onSaveEdit = useCallback(
    async (id: string) => {
      const trimmed = editDraft.trim();
      if (!trimmed) return;
      const res = await sendJson<CommentView>(`/api/comments/${id}`, "PATCH", {
        body: trimmed,
      });
      if (res.success && res.data) {
        setComments((prev) =>
          prev.map((c) => (c.id === id ? (res.data as CommentView) : c))
        );
        setEditing(null);
        setEditDraft("");
      }
    },
    [editDraft]
  );

  const onDelete = useCallback(async (id: string) => {
    const res = await sendJson<{ id: string }>(
      `/api/comments/${id}`,
      "DELETE"
    );
    if (res.success) {
      // Cascade removes replies server-side; drop them locally too.
      setComments((prev) =>
        prev.filter((c) => c.id !== id && c.parentId !== id)
      );
    }
  }, []);

  const tree = useMemo(() => buildTree(comments), [comments]);

  const renderComment = (c: CommentView, isReply: boolean) => {
    const mine = !!currentUserId && c.authorId === currentUserId;
    const isEditing = editing === c.id;
    return (
      <div
        key={c.id}
        className={`flex gap-3 ${isReply ? "mt-3" : ""}`}
      >
        <div
          className="w-7 h-7 shrink-0 rounded-full bg-paper border border-ink/10 flex items-center justify-center text-[10px] font-medium text-ink/60"
          aria-hidden="true"
        >
          {initials(c.authorName, c.authorEmail)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink/80">
              {displayName(c.authorName, c.authorEmail)}
            </span>
            <span className="text-[11px] text-ink/35">
              {timeAgo(c.createdAt)}
              {c.updatedAt !== c.createdAt ? " · edited" : ""}
            </span>
          </div>
          {isEditing ? (
            <div className="mt-1">
              <textarea
                value={editDraft}
                onChange={(e) => setEditDraft(e.target.value)}
                rows={2}
                className="w-full text-sm border border-ink/15 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-accent"
              />
              <div className="mt-1 flex gap-3">
                <button
                  onClick={() => onSaveEdit(c.id)}
                  className="text-xs text-accent hover:underline"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditing(null);
                    setEditDraft("");
                  }}
                  className="text-xs text-ink/50 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-0.5 text-sm text-ink/70">
              <Body body={c.body} />
            </div>
          )}
          {!isEditing && canWrite ? (
            <div className="mt-1 flex items-center gap-3">
              {!isReply ? (
                <button
                  onClick={() =>
                    setReplyTo((v) => (v === c.id ? null : c.id))
                  }
                  className="text-[11px] text-ink/50 hover:text-accent hover:underline"
                >
                  Reply
                </button>
              ) : null}
              {mine ? (
                <button
                  onClick={() => {
                    setEditing(c.id);
                    setEditDraft(c.body);
                  }}
                  className="text-[11px] text-ink/50 hover:text-accent hover:underline"
                >
                  Edit
                </button>
              ) : null}
              {mine ? (
                <button
                  onClick={() => onDelete(c.id)}
                  className="text-[11px] text-ink/50 hover:text-red-600 hover:underline"
                >
                  Delete
                </button>
              ) : null}
            </div>
          ) : null}

          {replyTo === c.id && !isReply && canWrite ? (
            <div className="mt-2">
              <textarea
                value={replyDraft}
                onChange={(e) => setReplyDraft(e.target.value)}
                rows={2}
                placeholder="Write a reply… use @name to mention"
                className="w-full text-sm border border-ink/15 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:border-accent"
              />
              <div className="mt-1 flex gap-3">
                <button
                  onClick={() => onSubmitReply(c.id)}
                  disabled={posting || !replyDraft.trim()}
                  className="text-xs text-accent hover:underline disabled:text-ink/30 disabled:no-underline"
                >
                  Reply
                </button>
                <button
                  onClick={() => {
                    setReplyTo(null);
                    setReplyDraft("");
                  }}
                  className="text-xs text-ink/50 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <div>
      <h3 className="text-sm font-medium text-ink/70">
        Discussion
        {comments.length > 0 ? (
          <span className="ml-1.5 text-ink/40">({comments.length})</span>
        ) : null}
      </h3>

      <div className="mt-3">
        {loading ? (
          <div className="text-sm text-ink/40">Loading comments…</div>
        ) : error ? (
          <div className="text-sm text-red-600">{error}</div>
        ) : tree.length === 0 ? (
          <div className="text-sm text-ink/40">
            No comments yet. Start the discussion.
          </div>
        ) : (
          <ul className="space-y-4">
            {tree.map(({ comment, replies }) => (
              <li key={comment.id}>
                {renderComment(comment, false)}
                {replies.length > 0 ? (
                  <div className="ml-10 border-l border-ink/10 pl-3">
                    {replies.map((r) => renderComment(r, true))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite ? (
        <div className="mt-4 border-t border-ink/10 pt-4">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            placeholder="Add a comment… use @name to mention a teammate"
            className="w-full text-sm border border-ink/15 rounded-md px-3 py-2 bg-white focus:outline-none focus:border-accent"
          />
          {postError ? (
            <p className="mt-1 text-xs text-red-600">{postError}</p>
          ) : null}
          <div className="mt-2 flex justify-end">
            <button
              onClick={onSubmit}
              disabled={posting || !draft.trim()}
              className="text-sm px-3 py-1.5 rounded-md bg-accent text-white disabled:opacity-40"
            >
              {posting ? "Posting…" : "Comment"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
