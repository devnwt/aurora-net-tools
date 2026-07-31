import {
  type CSSProperties,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { useTranslation } from "react-i18next";
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

export function Card({ className, children, style }: { className?: string; children: ReactNode; style?: CSSProperties }) {
  return <div className={cn("rounded-lg border border-border bg-surface p-5", className)} style={style}>{children}</div>;
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

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-12 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
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
  const { t } = useTranslation();
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
          <button onClick={onClose} aria-label={t("common:a11y.close")} className="text-muted hover:text-text cursor-pointer">✕</button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-primary", className)}
      role="status"
      aria-label={t("common:a11y.loading")}
    />
  );
}

/** Switch ON/OFF controlado. `busy` desabilita e sinaliza carregamento. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  busy,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
}) {
  const off = disabled || busy;
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm", off && "opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-busy={busy}
        disabled={off}
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-surface-2", !off && "cursor-pointer")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all", busy && "animate-pulse", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label && <span>{label}</span>}
    </label>
  );
}
