"use client";

import type { ReactNode } from "react";

// Shared labeled form field primitives so every account form has identical label
// / input / error styling. Controlled inputs only — parents own the state.

interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, children }: FieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink/70">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink/40">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-md border border-ink/10 bg-white px-3 py-2 text-sm text-ink/80 outline-none focus:border-accent focus:ring-1 focus:ring-accent disabled:opacity-60";

export function TextInput(
  props: React.InputHTMLAttributes<HTMLInputElement>
) {
  return <input {...props} className={INPUT_CLASS} />;
}

export function SelectInput(
  props: React.SelectHTMLAttributes<HTMLSelectElement>
) {
  return <select {...props} className={INPUT_CLASS} />;
}

interface ToggleProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}

// A labeled checkbox toggle used for boolean preferences.
export function Toggle({ id, label, hint, checked, disabled, onChange }: ToggleProps) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-ink/20 text-accent focus:ring-accent disabled:opacity-60"
      />
      <span>
        <span className="block text-sm text-ink/80">{label}</span>
        {hint ? <span className="block text-xs text-ink/40">{hint}</span> : null}
      </span>
    </label>
  );
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
}

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-white hover:opacity-90",
  secondary: "border border-ink/15 bg-white text-ink/70 hover:bg-ink/5",
  danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
};

export function Button({ variant = "primary", className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${BUTTON_VARIANTS[variant]} ${className ?? ""}`}
    />
  );
}
