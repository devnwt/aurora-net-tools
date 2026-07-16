import { useEffect, useState } from "react";
import { Download, Eye, Save } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { BackupFull, BackupMeta, Device } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Button, Card, EmptyState, Modal, Select, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const fmtSize = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

interface UploadResult {
  ok: boolean;
  detail: string;
}
interface BackupCreated {
  id: number;
  uploads?: { ftp?: UploadResult; s3?: UploadResult };
}

export function Backups() {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<BackupMeta[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [viewing, setViewing] = useState<BackupFull | null>(null);
  const [sendFtp, setSendFtp] = useState(false);
  const [sendS3, setSendS3] = useState(false);
  const [uploads, setUploads] = useState<{ ftp?: UploadResult; s3?: UploadResult } | null>(null);

  function load() {
    setLoading(true);
    api.get<BackupMeta[]>("/backups").then(setItems).finally(() => setLoading(false));
  }
  useEffect(() => {
    load();
    api.get<Device[]>("/devices").then((d) => setDevices(d.filter((x) => x.device_type === "routeros")));
  }, []);

  async function create() {
    if (!target) return;
    setCreating(true);
    setErr("");
    setUploads(null);
    try {
      const r = await api.post<BackupCreated>("/backups", { device_id: Number(target), send_ftp: sendFtp, send_s3: sendS3 });
      setUploads(r.uploads && Object.keys(r.uploads).length ? r.uploads : null);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function download(b: BackupMeta) {
    const full = await api.get<BackupFull>(`/backups/${b.id}`);
    const blob = new Blob([full.content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${b.device_name}-${b.created_at.slice(0, 19).replace(/[:T]/g, "-")}.rsc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function view(b: BackupMeta) {
    setViewing(await api.get<BackupFull>(`/backups/${b.id}`));
  }

  async function remove(b: BackupMeta) {
    if (!(await confirm({ title: "Excluir backup", message: `Excluir o backup de ${b.device_name} (${new Date(b.created_at).toLocaleString("pt-BR")})?` }))) return;
    await api.del(`/backups/${b.id}`);
    load();
  }

  return (
    <div>
      <PageHeader title="Backups" subtitle="Export de configuração RouterOS (/export)" />

      <Card className="mb-5">
        <h2 className="mb-3 text-sm font-semibold">Novo backup</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} className="w-64">
            <option value="">— selecione um RouterOS —</option>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.ip}</option>)}
          </Select>
          <label className="inline-flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={sendFtp} onChange={(e) => setSendFtp(e.target.checked)} className="h-4 w-4 accent-primary" />
            Enviar por FTP
          </label>
          <label className="inline-flex items-center gap-1.5 text-sm text-muted">
            <input type="checkbox" checked={sendS3} onChange={(e) => setSendS3(e.target.checked)} className="h-4 w-4 accent-primary" />
            Enviar por MinIO/S3
          </label>
          <Button onClick={create} disabled={creating || !target}>
            {creating ? <Spinner /> : <Save className="h-4 w-4" />} Criar backup
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">Configure os destinos em <span className="font-mono">Settings → FTP / MinIO</span>.</p>
        {err && <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{err}</p>}
        {uploads && (
          <div className="mt-3 space-y-2">
            {(["ftp", "s3"] as const).map((k) => {
              const u = uploads[k];
              if (!u) return null;
              return (
                <p key={k} className={`rounded-lg border p-2 text-xs ${u.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger"}`}>
                  <span className="font-semibold uppercase">{k === "s3" ? "MinIO/S3" : "FTP"}:</span> {u.detail}
                </p>
              );
            })}
          </div>
        )}
      </Card>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum backup" hint="Crie um backup selecionando um device acima." />
      ) : (
        <Table head={<><Th>Device</Th><Th>Criado em</Th><Th>Tamanho</Th><Th className="text-right">Ações</Th></>}>
          {items.map((b) => (
            <tr key={b.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{b.device_name}</Td>
              <Td className="whitespace-nowrap text-xs text-muted">{new Date(b.created_at).toLocaleString("pt-BR")}</Td>
              <Td className="font-mono text-muted">{fmtSize(b.size)}</Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => view(b)}><Eye className="h-4 w-4" /> Ver</Button>
                  <Button variant="ghost" onClick={() => download(b)}><Download className="h-4 w-4" /> Baixar</Button>
                  <Button variant="danger" onClick={() => remove(b)}>Excluir</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {viewing && (
        <Modal title={`Backup #${viewing.id}`} onClose={() => setViewing(null)}>
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-bg p-3 font-mono text-xs whitespace-pre-wrap">
            {viewing.content || "(vazio)"}
          </pre>
        </Modal>
      )}
    </div>
  );
}
