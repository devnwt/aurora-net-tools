import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { rosGet } from "@/lib/rosClient";
import type { Device, RosSystem, SystemResp } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, EmptyState, Spinner } from "@/components/ui";

interface Row {
  busy: boolean;
  summary?: RosSystem;
  error?: string;
}

export function Upgrades() {
  const { t } = useTranslation();
  const [devices, setDevices] = useState<Device[]>([]);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [loading, setLoading] = useState(true);

  async function probe(d: Device) {
    setRows((r) => ({ ...r, [d.id]: { busy: true } }));
    try {
      const res = await rosGet<SystemResp>(d.id, "/system");
      setRows((r) => ({ ...r, [d.id]: { busy: false, summary: res.summary } }));
    } catch (e) {
      setRows((r) => ({ ...r, [d.id]: { busy: false, error: e instanceof ApiError ? t("ops:shared.errorStatus", { status: e.status }) : String(e) } }));
    }
  }

  function checkAll(list: Device[]) {
    list.filter((d) => d.device_type === "routeros").forEach(probe);
  }

  useEffect(() => {
    api.get<Device[]>("/devices").then((d) => {
      setDevices(d);
      setLoading(false);
      checkAll(d);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ros = devices.filter((d) => d.device_type === "routeros");

  return (
    <div>
      <PageHeader
        title={t("ops:upgrades.title")}
        actions={
          <Button onClick={() => checkAll(devices)}>
            <RefreshCw className="h-4 w-4" /> {t("ops:upgrades.check")}
          </Button>
        }
      />
      <Card className="mb-4 text-xs text-muted">
        {t("ops:upgrades.note")}
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : ros.length === 0 ? (
        <EmptyState title={t("ops:upgrades.emptyTitle")} hint={t("ops:upgrades.emptyHint")} />
      ) : (
        <Table head={<><Th>{t("ops:upgrades.col.device")}</Th><Th>{t("ops:upgrades.col.rosCurrent")}</Th><Th>{t("ops:upgrades.col.fwCurrent")}</Th><Th>{t("ops:upgrades.col.fwUpgrade")}</Th><Th>{t("common:labels.status")}</Th></>}>
          {ros.map((d) => {
            const row = rows[d.id];
            const s = row?.summary;
            const pending = s && s.current_firmware && s.upgrade_firmware && s.current_firmware !== s.upgrade_firmware;
            return (
              <tr key={d.id} className="hover:bg-surface-2 transition-colors duration-200">
                <Td className="font-medium">{d.name}</Td>
                <Td className="font-mono">{s?.version ?? "—"}</Td>
                <Td className="font-mono">{s?.current_firmware ?? "—"}</Td>
                <Td className="font-mono">{s?.upgrade_firmware ?? "—"}</Td>
                <Td>
                  {row?.busy ? (
                    <Spinner />
                  ) : row?.error ? (
                    <Badge tone="danger">{row.error}</Badge>
                  ) : pending ? (
                    <Badge tone="danger">{t("ops:upgrades.fwPending")}</Badge>
                  ) : s ? (
                    <Badge tone="ok">{t("ops:upgrades.upToDate")}</Badge>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
