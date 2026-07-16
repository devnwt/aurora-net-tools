import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { AuditEntry, Device, Group } from "@/lib/types";
import { groupBySite } from "@/lib/mikrotik";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

interface RunResult {
  device: Device;
  ok: boolean;
  text: string;
}

export function Commands() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [command, setCommand] = useState("/system/resource/print");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<RunResult[]>([]);
  const [history, setHistory] = useState<AuditEntry[]>([]);

  function loadHistory() {
    api.get<AuditEntry[]>("/audit?limit=50").then((a) => setHistory(a.filter((x) => x.target_kind === "device")));
  }
  useEffect(() => {
    Promise.all([api.get<Device[]>("/devices"), api.get<Group[]>("/groups")]).then(([d, g]) => {
      setDevices(d);
      setGroups(g);
    });
    loadHistory();
  }, []);

  const sites = useMemo(() => groupBySite(devices, groups), [devices, groups]);

  function toggle(id: number) {
    setSelected((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }
  const selectAll = () => setSelected(new Set(devices.map((d) => d.id)));
  const deselectAll = () => setSelected(new Set());

  async function execute() {
    if (selected.size === 0 || !command) return;
    setRunning(true);
    setResults([]);
    const targets = devices.filter((d) => selected.has(d.id));
    const out = await Promise.all(
      targets.map(async (device): Promise<RunResult> => {
        try {
          const r = await api.post<{ output: string }>(`/devices/${device.id}/exec`, { command, protocol: "ssh" });
          return { device, ok: true, text: r.output || "(sem saída)" };
        } catch (e) {
          return { device, ok: false, text: e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e) };
        }
      }),
    );
    setResults(out);
    setRunning(false);
    loadHistory();
  }

  return (
    <div>
      <PageHeader title="Mass Commands" />

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold">Execute Command</h2>
        <label className="text-[11px] uppercase tracking-wide text-muted">Command</label>
        <Input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="mt-1 font-mono"
          placeholder="/system/resource/print"
        />
        <p className="mt-1 text-xs text-muted">Somente leitura — comandos de escrita são recusados pela allowlist.</p>

        <div className="mt-4 mb-2 flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted">Select Devices</span>
          <Button variant="ghost" onClick={selectAll}>Select All</Button>
          <Button variant="ghost" onClick={deselectAll}>Deselect All</Button>
        </div>
        <div className="rounded-lg border border-border p-3">
          {sites.map((site) => (
            <div key={site.id ?? "none"} className="mb-2 last:mb-0">
              <p className="mb-1 text-xs font-semibold text-muted">{site.name} ({site.devices.length})</p>
              <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
                {site.devices.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-2 cursor-pointer">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
                    <span className="font-medium">{d.name}</span>
                    <span className="font-mono text-xs text-muted">{d.ip}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <Button className="mt-4" onClick={execute} disabled={running || selected.size === 0 || !command}>
          {running ? <Spinner /> : <Play className="h-4 w-4" />} Execute ({selected.size})
        </Button>
      </Card>

      {results.length > 0 && (
        <Card className="mb-5">
          <h2 className="mb-3 text-sm font-semibold">Resultados</h2>
          <div className="space-y-3">
            {results.map((r) => (
              <div key={r.device.id}>
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium">{r.device.name}</span>
                  <span className="font-mono text-xs text-muted">{r.device.ip}</span>
                  <Badge tone={r.ok ? "ok" : "danger"}>{r.ok ? "ok" : "falha"}</Badge>
                </div>
                <pre className={cn("max-h-64 overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs whitespace-pre-wrap", !r.ok && "text-danger")}>
                  {r.text}
                </pre>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 text-sm font-semibold">Command History</h2>
        {history.length === 0 ? (
          <p className="text-xs text-muted">No commands yet</p>
        ) : (
          <Table head={<><Th>Command</Th><Th>Proto</Th><Th>Result</Th><Th>ms</Th><Th>Date</Th></>}>
            {history.map((a) => (
              <tr key={a.id} className="hover:bg-surface-2 transition-colors duration-200">
                <Td className="max-w-md truncate font-mono text-xs" title={a.command}>{a.command}</Td>
                <Td><Badge>{a.protocol}</Badge></Td>
                <Td>{a.ok ? <Badge tone="ok">ok</Badge> : <Badge tone="danger" title={a.error ?? ""}>falha</Badge>}</Td>
                <Td className="font-mono text-xs text-muted">{a.duration_ms}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{new Date(a.ts).toLocaleString("pt-BR")}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
