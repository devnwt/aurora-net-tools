import { type ReactNode } from "react";

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={`px-4 py-2.5 font-medium ${className ?? ""}`}>{children}</th>;
}

export function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return <td className={`px-4 py-2.5 ${className ?? ""}`} title={title}>{children}</td>;
}
