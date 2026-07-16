import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { rosGet } from "@/lib/rosClient";
import type { Device, LogsResp, RosRecord } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

function tone(topics: string): string {
  const t = (topics || "").toLowerCase();
  if (t.includes("critical") || t.includes("error")) return "text-danger";
  if (t.includes("warning")) return "text-accent";
  return "";
}

export function Logs() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [target, setTarget] = useState("");
  const [rows, setRows] = useState<RosRecord[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<Device[]>("/devices").then((d) => setDevices(d.filter((x) => x.device_type === "routeros")));
  }, []);

  async function load(id: string) {
    if (!id) return;
    setBusy(true);
    setErr("");
    try {
      const r = await rosGet<LogsResp>(Number(id), "/logs");
      setRows([...r.logs].reverse()); // mais recentes primeiro
    } catch (e) {
      setErr(errMsg(e));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter((r) => (r.message ?? "").toLowerCase().includes(q) || (r.topics ?? "").toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <div>
      <PageHeader title="Logs" subtitle="Registro do device (/log print)" />

      <Card className="mb-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={target}
            onChange={(e) => {
              setTarget(e.target.value);
              load(e.target.value);
            }}
            className="w-64"
          >
            <option value="">— selecione um RouterOS —</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>)}
          </Select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filtrar mensagem/tópico…" className="max-w-xs" />
          <Button variant="ghost" onClick={() => load(target)} disabled={!target || busy}>
            {busy ? <Spinner /> : <RefreshCw className="h-4 w-4" />} Atualizar
          </Button>
          {rows && <span className="text-xs text-muted">{filtered.length} entrada(s)</span>}
        </div>
        {err && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
      </Card>

      {busy && !rows ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : !rows ? (
        <EmptyState title="Selecione um device" hint="Escolha um RouterOS para ver os logs." />
      ) : filtered.length === 0 ? (
        <EmptyState title="Sem entradas" />
      ) : (
        <Table head={<><Th>Hora</Th><Th>Tópicos</Th><Th>Mensagem</Th></>}>
          {filtered.map((r, i) => (
            <tr key={i} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="whitespace-nowrap font-mono text-xs text-muted">{r.time ?? "—"}</Td>
              <Td className={cn("whitespace-nowrap font-mono text-xs", tone(r.topics ?? ""))}>{r.topics ?? "—"}</Td>
              <Td className="font-mono text-xs">{r.message ?? ""}</Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
