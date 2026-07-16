import { useEffect, useState } from "react";
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
  const [devices, setDevices] = useState<Device[]>([]);
  const [rows, setRows] = useState<Record<number, Row>>({});
  const [loading, setLoading] = useState(true);

  async function probe(d: Device) {
    setRows((r) => ({ ...r, [d.id]: { busy: true } }));
    try {
      const res = await rosGet<SystemResp>(d.id, "/system");
      setRows((r) => ({ ...r, [d.id]: { busy: false, summary: res.summary } }));
    } catch (e) {
      setRows((r) => ({ ...r, [d.id]: { busy: false, error: e instanceof ApiError ? `Erro ${e.status}` : String(e) } }));
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
        title="Upgrades"
        actions={
          <Button onClick={() => checkAll(devices)}>
            <RefreshCw className="h-4 w-4" /> Check for Updates
          </Button>
        }
      />
      <Card className="mb-4 text-xs text-muted">
        Visão somente leitura de versões. As ações de upgrade (RouterOS/firmware) são operações de escrita,
        desabilitadas no MVP read-only.
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : ros.length === 0 ? (
        <EmptyState title="Nenhum RouterOS" hint="Cadastre um device RouterOS." />
      ) : (
        <Table head={<><Th>Device</Th><Th>Current ROS</Th><Th>Current FW</Th><Th>Upgrade FW</Th><Th>Status</Th></>}>
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
                    <Badge tone="danger">FW pending</Badge>
                  ) : s ? (
                    <Badge tone="ok">up to date</Badge>
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
