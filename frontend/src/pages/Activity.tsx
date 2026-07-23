import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, EmptyState, Spinner } from "@/components/ui";

export function Activity() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<AuditEntry[]>("/audit?limit=200").then(setItems).finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader title={t("activity:title")} subtitle={t("activity:subtitle")} />
      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title={t("activity:empty.title")} hint={t("activity:empty.hint")} />
      ) : (
        <Table head={<><Th>{t("activity:columns.when")}</Th><Th>{t("activity:columns.actor")}</Th><Th>{t("activity:columns.protocol")}</Th><Th>{t("activity:columns.command")}</Th><Th>{t("common:labels.type")}</Th><Th>{t("common:labels.status")}</Th><Th>{t("activity:columns.ms")}</Th></>}>
          {items.map((a) => (
            <tr key={a.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(a.ts).toLocaleString("pt-BR")}</Td>
              <Td className="text-xs">{a.actor}</Td>
              <Td><Badge>{a.protocol}</Badge></Td>
              <Td className="max-w-xs truncate font-mono text-xs" title={a.command}>{a.command}</Td>
              <Td><Badge tone={a.classification === "write" ? "danger" : "muted"}>{a.classification}</Badge></Td>
              <Td>{a.ok ? <Badge tone="ok">{t("activity:result.ok")}</Badge> : <Badge tone="danger" title={a.error ?? ""}>{t("activity:result.fail")}</Badge>}</Td>
              <Td className="font-mono text-xs text-muted">{a.duration_ms}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
