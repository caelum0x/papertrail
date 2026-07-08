"use client";

import { Card } from "@/components/account/Card";
import { Field, TextInput } from "@/components/account/fields";

interface AvatarPanelProps {
  name: string | null;
  email: string;
  avatarUrl: string;
  onAvatarChange: (next: string) => void;
  disabled?: boolean;
}

function initialsOf(name: string | null, email: string): string {
  const source = (name ?? email).trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

// Avatar preview + URL entry. The app stores avatars as URLs (no upload pipeline
// here), so this shows a live preview and validates the URL on submit via the
// form's zod schema. Falls back to initials when no/invalid image.
export function AvatarPanel({
  name,
  email,
  avatarUrl,
  onAvatarChange,
  disabled,
}: AvatarPanelProps) {
  return (
    <Card title="Avatar" description="Shown next to your name across the workspace.">
      <div className="flex items-center gap-4">
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-16 w-16 rounded-full border border-ink/10 object-cover"
          />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 text-lg font-semibold text-accent">
            {initialsOf(name, email)}
          </span>
        )}
        <div className="flex-1">
          <Field
            label="Avatar URL"
            htmlFor="avatar_url"
            hint="Paste a link to a square image. Leave blank to use your initials."
          >
            <TextInput
              id="avatar_url"
              type="url"
              inputMode="url"
              placeholder="https://…"
              value={avatarUrl}
              disabled={disabled}
              onChange={(e) => onAvatarChange(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </Card>
  );
}
