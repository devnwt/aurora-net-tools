import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Globe, Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { Device } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { MaskedInput } from "@/components/MaskedInput";

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
  const { t } = useTranslation();
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
      setError(e instanceof ApiError ? t("ops:shared.errorWithStatus", { status: e.status, message: e.message }) : String(e));
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
      setError(e instanceof ApiError ? t("ops:shared.errorWithStatus", { status: e.status, message: e.message }) : String(e));
      setAdding(null);
    }
  }

  return (
    <div>
      <PageHeader title={t("ops:scan.title")} />
      <Card className="mb-5">
        <h2 className="mb-4 text-sm font-semibold">{t("ops:scan.configTitle")}</h2>

        <div className="space-y-1">
          <label className="text-[11px] uppercase tracking-wide text-muted">{t("ops:scan.ipRange")}</label>
          <MaskedInput mask="network" value={form.range} onValueChange={(v) => set("range", v)} placeholder="192.168.88.1-254 ou 192.168.88.0/24" className="font-mono" />
          <p className="text-xs text-muted">{t("ops:scan.rangeHint")}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Labeled label={t("common:labels.username")}><Input value={form.username} onChange={(e) => set("username", e.target.value)} /></Labeled>
          <Labeled label={t("common:labels.password")}><Input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} /></Labeled>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Labeled label={t("ops:scan.sshPort")}><MaskedInput mask="port" value={form.sshPort} onValueChange={(v) => set("sshPort", v)} className="font-mono" /></Labeled>
          <Labeled label={t("ops:scan.apiHttpsPort")}><MaskedInput mask="port" value={form.apiHttps} onValueChange={(v) => set("apiHttps", v)} className="font-mono" /></Labeled>
          <Labeled label={t("ops:scan.apiHttpPort")}><MaskedInput mask="port" value={form.apiHttp} onValueChange={(v) => set("apiHttp", v)} className="font-mono" /></Labeled>
        </div>

        <Button className="mt-4" onClick={startScan} disabled={busy || !form.range}>
          {busy ? <Spinner /> : <Globe className="h-4 w-4" />} {busy ? t("ops:scan.scanning") : t("ops:scan.start")}
        </Button>
        {error && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{error}</p>}
      </Card>

      {result && (
        <Card>
          <h2 className="mb-3 text-sm font-semibold">
            {t("ops:scan.results")} <span className="text-muted">· {t("ops:scan.resultCount", { found: result.found.length, scanned: result.scanned })}</span>
          </h2>
          {result.found.length === 0 ? (
            <EmptyState title={t("ops:scan.emptyTitle")} hint={t("ops:scan.emptyHint")} />
          ) : (
            <Table head={<><Th>IP</Th><Th>{t("ops:scan.col.identity")}</Th><Th>Board</Th><Th>RouterOS</Th><Th className="text-right">{t("common:labels.actions")}</Th></>}>
              {result.found.map((f) => (
                <tr key={f.ip} className="hover:bg-surface-2 transition-colors duration-200">
                  <Td className="font-mono">{f.ip}</Td>
                  <Td className="font-medium">{f.identity || "—"}</Td>
                  <Td className="font-mono text-muted">{f.board || "—"}</Td>
                  <Td className="font-mono text-muted">{f.version || "—"}</Td>
                  <Td className="text-right">
                    <Button variant="ghost" onClick={() => importDevice(f)} disabled={adding !== null}>
                      {adding === f.ip ? <Spinner /> : <Plus className="h-4 w-4" />} {t("common:actions.add")}
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
