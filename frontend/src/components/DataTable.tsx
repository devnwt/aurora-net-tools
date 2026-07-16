import type { ReactNode } from "react";
import type { RosRecord } from "@/lib/types";
import { Table, Td, Th } from "@/components/Table";
import { EmptyState } from "@/components/ui";

export interface Column {
  key: string;
  label?: string;
  /** Renderização customizada da célula (ex.: badges). */
  render?: (value: string, row: RosRecord) => ReactNode;
  className?: string;
}

/**
 * Tabela para registros RouterOS. Com `columns`, renderiza só essas colunas
 * (na ordem dada); sem `columns`, deriva a união de chaves de todas as linhas.
 */
export function DataTable({
  rows,
  columns,
  empty = "Sem registros",
}: {
  rows: RosRecord[];
  columns?: Column[];
  empty?: string;
}) {
  if (!rows || rows.length === 0) return <EmptyState title={empty} />;

  const cols: Column[] =
    columns ??
    Array.from(
      rows.reduce((s, r) => {
        Object.keys(r).forEach((k) => s.add(k));
        return s;
      }, new Set<string>()),
    ).map((k) => ({ key: k }));

  return (
    <Table
      head={cols.map((c) => (
        <Th key={c.key} className="whitespace-nowrap">{c.label ?? c.key}</Th>
      ))}
    >
      {rows.map((r, i) => (
        <tr key={i} className="hover:bg-surface-2 transition-colors duration-200">
          {cols.map((c) => (
            <Td key={c.key} className={c.className ?? "whitespace-nowrap font-mono text-xs"}>
              {c.render ? c.render(r[c.key] ?? "", r) : r[c.key] ?? ""}
            </Td>
          ))}
        </tr>
      ))}
    </Table>
  );
}
