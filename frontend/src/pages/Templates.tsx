import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Template } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, EmptyState, Input, Modal, Select, Spinner, Textarea } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const CATEGORIES = ["Security", "Network", "Monitoring", "Maintenance", "Other"];
const BLANK = { name: "", description: "", category: "Security", type: "commands", body: "", enabled: true };

function toneOf(cat: string): "primary" | "accent" | "ok" | "muted" | "danger" {
  return ({ Security: "danger", Network: "primary", Monitoring: "accent", Maintenance: "ok" } as const)[cat] ?? "muted";
}

export function Templates() {
  const { confirm } = useConfirm();
  const [items, setItems] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);

  function load() {
    setLoading(true);
    api.get<Template[]>("/templates").then(setItems).finally(() => setLoading(false));
  }
  useEffect(load, []);

  function openNew() {
    setEditing(null);
    setForm(BLANK);
    setOpen(true);
  }
  function openEdit(t: Template) {
    setEditing(t);
    setForm({ name: t.name, description: t.description, category: t.category, type: t.type, body: t.body, enabled: t.enabled });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing) await api.patch(`/templates/${editing.id}`, form);
      else await api.post("/templates", form);
      setOpen(false);
      load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: Template) {
    if (!(await confirm({ title: "Excluir template", message: `Excluir o template "${t.name}"?` }))) return;
    await api.del(`/templates/${t.id}`);
    load();
  }

  const lines = (t: Template) => t.body.split("\n").filter((l) => l.trim()).length;

  return (
    <div>
      <PageHeader title="Modelos de Comando" actions={<Button onClick={openNew}><Plus className="h-4 w-4" /> Adicionar Modelo</Button>} />

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : items.length === 0 ? (
        <EmptyState title="Nenhum modelo ainda" hint="Crie conjuntos de comandos predefinidos para configuração rápida." />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => (
            <Card key={t.id} className="p-4">
              <div className="mb-2 flex items-start justify-between gap-2">
                <h3 className="font-semibold leading-tight">{t.name}</h3>
                <Badge tone={toneOf(t.category)}>{t.category}</Badge>
              </div>
              {t.description && <p className="mb-2 text-xs text-muted">{t.description}</p>}
              <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
                <Badge>{t.type === "script" ? "Script" : "Comandos"}</Badge>
                <span>{lines(t)} linha(s)</span>
                {!t.enabled && <Badge tone="muted">desabilitado</Badge>}
              </div>
              <pre className="mb-3 max-h-28 overflow-auto rounded-lg border border-border bg-bg p-2 font-mono text-[11px] text-muted whitespace-pre-wrap">
                {t.body || "(vazio)"}
              </pre>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => openEdit(t)}>Editar</Button>
                <Button variant="danger" onClick={() => remove(t)}>Excluir</Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <Modal
          title={editing ? "Editar Modelo" : "Novo Modelo"}
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving || !form.name || !form.body.trim()}>{saving ? "Salvando…" : editing ? "Salvar" : "Criar"}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <Field label="NOME"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="ex.: Serviços Seguros" autoFocus /></Field>
            <Field label="DESCRIÇÃO"><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Descrição opcional" /></Field>
            <Field label="CATEGORIA">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="TIPO">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.type === "commands"} onChange={() => setForm({ ...form, type: "commands" })} /> Comandos (um por linha)
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" checked={form.type === "script"} onChange={() => setForm({ ...form, type: "script" })} /> Script (/system/script)
                </label>
              </div>
            </Field>
            <Field label={form.type === "script" ? "SCRIPT" : "COMANDOS (UM POR LINHA)"}>
              <Textarea
                rows={7}
                value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })}
                className="font-mono text-xs"
                placeholder={"/ip/service/disable telnet\n/ip/service/disable ftp"}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Habilitado
            </label>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] uppercase tracking-wide text-muted">{label}</label>
      {children}
    </div>
  );
}
