"use client";

import { NotificationsHeader } from "../_components/NotificationsHeader";
import { PrefsList } from "../_components/PrefsList";
import { usePrefs } from "../_components/usePrefs";

// Dedicated delivery-preferences sub-page: the same per-type toggles surfaced
// inline on the feed, given their own route for direct linking. Reuses the
// shared usePrefs hook and the existing /api/notification-prefs endpoint.
export default function NotificationPreferencesPage() {
  const { prefsError, savingPref, isEnabled, onTogglePref } = usePrefs();

  return (
    <div className="max-w-2xl">
      <NotificationsHeader
        title="Notification preferences"
        subtitle="Control which activity sends you an in-app notification."
        link={{ href: "/console/notifications", label: "← Notifications" }}
      />

      <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
        <PrefsList
          prefsError={prefsError}
          savingPref={savingPref}
          isEnabled={isEnabled}
          onTogglePref={onTogglePref}
        />
      </div>
    </div>
  );
}
