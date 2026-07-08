"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, sendJson } from "@/components/org-team/apiClient";

// Personal profile editor. A member may always edit their own profile within the
// active org, so there's no role gate here — the API enforces org/user scoping.

interface Profile {
  userId: string;
  orgId: string;
  email: string;
  displayName: string | null;
  title: string | null;
  avatarUrl: string | null;
  prefs: Record<string, unknown>;
}

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [title, setTitle] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<Profile>("/api/profile");
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load profile.");
      return;
    }
    setProfile(res.data);
    setDisplayName(res.data.displayName ?? "");
    setTitle(res.data.title ?? "");
    setAvatarUrl(res.data.avatarUrl ?? "");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setSaveError(null);
      setNotice(null);
      const res = await sendJson<Profile>("/api/profile", "PATCH", {
        display_name: displayName.trim() === "" ? null : displayName.trim(),
        title: title.trim() === "" ? null : title.trim(),
        avatar_url: avatarUrl.trim() === "" ? null : avatarUrl.trim(),
      });
      setSaving(false);
      if (!res.success || !res.data) {
        setSaveError(res.error ?? "Failed to save profile.");
        return;
      }
      setProfile(res.data);
      setNotice("Profile saved.");
    },
    [displayName, title, avatarUrl]
  );

  return (
    <div className="max-w-2xl">
      <Link
        href="/console/settings"
        className="text-sm text-accent hover:underline"
      >
        &larr; Settings
      </Link>
      <div className="mt-3">
        <h1 className="text-2xl font-semibold text-ink/80">Profile</h1>
        <p className="mt-1 text-sm text-ink/60">
          How you appear to teammates in this organization.
        </p>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading profile...</p>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : profile ? (
        <form
          onSubmit={onSave}
          className="mt-6 bg-white border border-ink/10 rounded-lg p-5 space-y-4"
        >
          <div>
            <label className="block text-sm text-ink/60">Email</label>
            <input
              type="text"
              value={profile.email}
              readOnly
              className="mt-1 w-full text-sm border border-ink/10 rounded px-3 py-2 bg-paper text-ink/60"
            />
            <p className="mt-1 text-xs text-ink/60">
              Your email is managed at the account level and can&apos;t be changed
              here.
            </p>
          </div>
          <div>
            <label className="block text-sm text-ink/60">Display name</label>
            <input
              type="text"
              value={displayName}
              maxLength={120}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Dr. Jane Doe"
              className="mt-1 w-full text-sm border border-ink/10 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-ink/60">Title</label>
            <input
              type="text"
              value={title}
              maxLength={120}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Principal Investigator"
              className="mt-1 w-full text-sm border border-ink/10 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>
          <div>
            <label className="block text-sm text-ink/60">Avatar URL</label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full text-sm border border-ink/10 rounded px-3 py-2 focus:outline-none focus:border-accent"
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {notice ? (
              <span className="text-sm text-ink/60">{notice}</span>
            ) : null}
          </div>
          {saveError ? (
            <p className="text-sm text-red-600">{saveError}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
