import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Globe, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Spinner } from "@/components/ui";

interface Found {
  ip: string;
  identity: string | null;
  version: string | null;
  board: string | null;
  ssh_port: number;
}
interface ScanResult {
  scanned: number;
  found: Found[];
}

export function ScanNetwork() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ range: "", username: "admin", password: "", sshPort: "22", apiHttps: "443", apiHttp: "80" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [adding, setAdding] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function startScan() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const r = await api.post<ScanResult>("/scan", {
        range: form.range,
        username: form.username,
        password: form.password,
        ssh_port: Number(form.sshPort) || 22,
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function importDevice(f: Found) {
    setAdding(f.ip);
    try {
      const d = await api.post<Device>("/devices", {
        name: f.identity || f.ip,
        ip: f.ip,
        device_type: "routeros",
        ssh_enabled: true,
        ssh_port: f.ssh_port,
      });
      navigate(`/devices/${d.id}/edit`); // atribui a credencial na tela de edição
    } catch (e) {
      setError(e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));
      setAdding(null);
    }
  }

  return (
    <div>
      <PageHeader title="Scan Network" />
      <Card className="mb-5">
        <h2 className="mb-4 text-sm font-semibold">Scan Configuration</h2>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted">IP Range</label>
          <Input value={form.range} onChange={(e) => set("range", e.target.value)} placeholder="192.168.88.1-254 or 192.168.88.0/24" className="font-mono" />
          <p className="text-xs text-muted">CIDR (192.168.88.0/24), range (192.168.88.1-254), ou IP único · máx. 512 hosts</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Labeled label="Username"><Input value={form.username} onChange={(e) => set("username", e.target.value)} /></Labeled>
          <Labeled label="Password"><Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Labeled>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Labeled label="SSH Port"><Input value={form.sshPort} onChange={(e) => set("sshPort", e.target.value)} className="font-mono" /></Labeled>
          <Labeled label="API Port (HTTPS)"><Input value={form.apiHttps} onChange={(e) => set("apiHttps", e.target.value)} className="font-mono" /></Labeled>
          <Labeled label="API Port (HTTP)"><Input value={form.apiHttp} onChange={(e) => set("apiHttp", e.target.value)} className="font-mono" /></Labeled>
        </div>

        <Button className="mt-4" onClick={startScan} disabled={busy || !form.range}>
          {busy ? <Spinner /> : <Globe className="h-4 w-4" />} {busy ? "Scanning…" : "Start Scan"}
        </Button>
        {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      </Card>

      {result && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">
            Resultados <span className="text-muted">· {result.found.length} RouterOS de {result.scanned} host(s)</span>
          </h2>
          {result.found.length === 0 ? (
            <EmptyState title="Nenhum RouterOS encontrado" hint="Verifique faixa, porta e credenciais." />
          ) : (
            <Table head={<><Th>IP</Th><Th>Identity</Th><Th>Board</Th><Th>RouterOS</Th><Th className="text-right">Ação</Th></>}>
              {result.found.map((f) => (
                <tr key={f.ip} className="hover:bg-surface-2 transition-colors duration-200">
                  <Td className="font-mono">{f.ip}</Td>
                  <Td className="font-medium">{f.identity || "—"}</Td>
                  <Td className="font-mono text-muted">{f.board || "—"}</Td>
                  <Td className="font-mono text-muted">{f.version || "—"}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => importDevice(f)} disabled={adding !== null}>
                      {adding === f.ip ? <Spinner /> : <Plus className="h-4 w-4" />} Add
                    </Button>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}
