import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, EmptyState, Spinner } from "@/components/ui";

export function Activity() {
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<AuditEntry[]>("/audit?limit=200").then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title="Atividade" subtitle="Auditoria de toda execução contra a rede" />
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Sem atividade" hint="Execuções aparecem aqui." />
      ) : (
        <Table head={<><Th>Quando</Th><Th>Ator</Th><Th>Proto</Th><Th>Comando</Th><Th>Tipo</Th><Th>Status</Th><Th>ms</Th></>}>
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(a.ts).toLocaleString("pt-BR")}</Td>
              <Td className="text-xs">{a.actor}</Td>
              <Td><Badge>{a.protocol}</Badge></Td>
              <Td className="max-w-xs truncate font-mono text-xs" title={a.command}>{a.command}</Td>
              <Td><Badge tone={a.classification === "write" ? "danger" : "muted"}>{a.classification}</Badge></Td>
              <Td>{a.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="danger" title={a.error ?? ""}>falha</Badge>}</Td>
              <Td className="font-mono text-xs text-muted">{a.duration_ms}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
