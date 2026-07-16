import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "accent" | "danger" }) {
  const variants = {
    primary: "bg-primary text-primary-fg hover:bg-primary/90",
    accent: "bg-accent text-accent-fg hover:bg-accent/90",
    ghost: "bg-transparent text-text hover:bg-surface-2 border border-border",
    danger: "bg-transparent text-danger hover:bg-danger/10 border border-danger/40",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium",
        "transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-bg",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text placeholder:text-muted",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text placeholder:text-muted",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-sm text-text cursor-pointer",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-lg border border-border bg-surface p-5", className)}>{children}</div>;
}

export function Badge({ children, tone = "muted", title }: { children: ReactNode; tone?: "muted" | "ok" | "danger" | "accent" | "primary"; title?: string }) {
  const tones = {
    muted: "bg-surface-2 text-muted",
    ok: "bg-ok/15 text-ok",
    danger: "bg-danger/15 text-danger",
    accent: "bg-accent/15 text-accent",
    primary: "bg-primary/15 text-primary",
  };
  return <span title={title} className={cn("inline-flex items-center rounded px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={cn("w-full rounded-lg border border-border bg-surface shadow-xl", wide ? "max-w-[95vw]" : "max-w-lg")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-muted hover:text-text cursor-pointer">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn("h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary", className)}
      role="status"
      aria-label="carregando"
    />
  );
}
