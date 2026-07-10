"use client";

import { useState } from "react";

export function ClaimInput(props: {
  onSubmit: (claim: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim().length >= 10) props.onSubmit(value.trim());
      }}
      className="flex flex-col gap-3"
    >
      <label htmlFor="claim" className="text-base font-medium text-ink/70">
        Paste a clinical trial or study claim
      </label>
      <textarea
        id="claim"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={6}
        maxLength={2000}
        placeholder='e.g. "Drug X reduced major cardiovascular events by 30% across all adult patients."'
        className="w-full rounded-xl border border-ink/15 bg-white p-4 text-base leading-relaxed focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-ink/40">{value.length}/2000</span>
        <button
          type="submit"
          disabled={props.loading || value.trim().length < 10}
          className="rounded-lg bg-accent px-6 py-3 text-base font-medium text-white disabled:opacity-40"
        >
          {props.loading ? "Verifying..." : "Verify claim"}
        </button>
      </div>
    </form>
  );
}
