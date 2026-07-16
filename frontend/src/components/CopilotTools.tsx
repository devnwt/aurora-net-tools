// Gestão das ferramentas do Copilot (MCP HTTP Stream, OpenAPI, Skill) por ORG.
// Suporta cadastrar VÁRIOS de cada tipo; usado na aba Settings → Copilot.
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { CopilotTool } from "@/lib/types";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

type ToolKind = "mcp" | "openapi" | "skill";
const KIND_LABEL: Record<ToolKind, string> = { mcp: "MCP HTTP Stream", openapi: "OpenAPI", skill: "Skill" };
const BLANK = { name: "", url: "", spec_url: "", base_url: "", content: "", auth_header: "", auth_value: "" };

interface Builtin {
  web: { enabled: boolean; url: string };
  fs: { enabled: boolean; root: string };
}

export function CopilotToolsManager() {
  const [tools, setTools] = useState<CopilotTool[]>([]);
  const [kind, setKind] = useState<ToolKind>("mcp");
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [bi, setBi] = useState<Builtin | null>(null);

  function load() { api.get<CopilotTool[]>("/copilot/tools").then(setTools); }
  useEffect(load, []);
  useEffect(() => { api.get<Builtin>("/copilot/builtin").then(setBi); }, []);

  async function saveBuiltin(next: Builtin) {
    setBi(next);
    try {
      const r = await api.put<Builtin>("/copilot/builtin", next);
      setBi(r);
      setMsg({ ok: true, text: "Ferramentas embutidas salvas." });
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
  }

  const canAdd = form.name && ((kind === "mcp" && form.url) || (kind === "openapi" && form.spec_url) || (kind === "skill" && form.content.trim()));

  async function add() {
    if (!canAdd) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/copilot/tools", { kind, ...form });
      setForm(BLANK);
      setMsg({ ok: true, text: `${KIND_LABEL[kind]} adicionado.` });
      load();
    } catch (e) { setMsg({ ok: false, text: errMsg(e) }); } finally { setBusy(false); }
  }
  async function del(id: number) { await api.del(`/copilot/tools/${id}`); load(); }
  async function test(id: number) {
    setBusy(true);
    try {
      const r = await api.post<{ ok: boolean; detail: string }>(`/copilot/tools/${id}/test`, {});
      setMsg({ ok: r.ok, text: r.detail });
    } finally { setBusy(false); }
  }
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const fi = e.target.files?.[0];
    if (!fi) return;
    const text = await fi.text();
    setForm((s) => ({ ...s, content: text, name: s.name || fi.name.replace(/\.[^.]+$/, "") }));
  }

  const byKind = (k: ToolKind) => tools.filter((t) => t.kind === k);

  return (
    <div>
      {/* Ferramentas embutidas (habilitadas por padrão) */}
      {bi && (
        <div className="mb-5 space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">Embutidas (habilitadas por padrão)</p>
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bi.web.enabled} onChange={(e) => saveBuiltin({ ...bi, web: { ...bi.web, enabled: e.target.checked } })} className="h-4 w-4 accent-primary" />
              <strong>Web Search (SearXNG)</strong>
            </label>
            <div className="mt-2 flex gap-2">
              <Input value={bi.web.url} onChange={(e) => setBi({ ...bi, web: { ...bi.web, url: e.target.value } })} placeholder="https://searxng.local (instância SearXNG)" className="font-mono text-xs" />
              <Button variant="ghost" onClick={() => saveBuiltin(bi)}>Salvar</Button>
            </div>
            <p className="mt-1 text-[11px] text-muted">A instância precisa ter o formato JSON habilitado. Sem URL, a busca fica indisponível.</p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={bi.fs.enabled} onChange={(e) => saveBuiltin({ ...bi, fs: { ...bi.fs, enabled: e.target.checked } })} className="h-4 w-4 accent-primary" />
              <strong>Filesystem</strong> <span className="text-xs text-muted">(rascunho para o chat)</span>
            </label>
            <div className="mt-2 flex gap-2">
              <Input value={bi.fs.root} onChange={(e) => setBi({ ...bi, fs: { ...bi.fs, root: e.target.value } })} placeholder="/tmp" className="font-mono text-xs" />
              <Button variant="ghost" onClick={() => saveBuiltin(bi)}>Salvar</Button>
            </div>
            <p className="mt-1 text-[11px] text-muted">Acesso restrito a esta raiz (list/read/write). Padrão <span className="font-mono">/tmp</span>.</p>
          </div>
        </div>
      )}

      <p className="mb-3 text-xs text-muted">
        Estenda o Copilot com servidores <strong>MCP</strong>, APIs <strong>OpenAPI</strong> ou <strong>Skills</strong> — pode cadastrar vários de cada tipo; todos ficam disponíveis nas conversas (escopados por ORG).
      </p>

      <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5 text-xs">
        {(["mcp", "openapi", "skill"] as ToolKind[]).map((k) => (
          <button key={k} onClick={() => { setKind(k); setForm(BLANK); }} className={cn("flex-1 rounded px-2 py-1 cursor-pointer", kind === k ? "bg-primary/20 text-primary" : "text-muted")}>{KIND_LABEL[k]}</button>
        ))}
      </div>

      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="nome" />
        {kind === "mcp" && <Input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://host/mcp" className="font-mono text-xs" />}
        {kind === "openapi" && (
          <>
            <Input value={form.spec_url} onChange={(e) => setForm({ ...form, spec_url: e.target.value })} placeholder="URL da spec (openapi.json)" className="font-mono text-xs" />
            <Input value={form.base_url} onChange={(e) => setForm({ ...form, base_url: e.target.value })} placeholder="base URL (opcional)" className="font-mono text-xs" />
          </>
        )}
        {kind === "skill" && (
          <input type="file" accept=".md,.txt" onChange={onFile} className="text-xs text-muted file:mr-2 file:rounded file:border-0 file:bg-surface-2 file:px-2 file:py-1 file:text-text" />
        )}
        {kind !== "skill" && (
          <>
            <Input value={form.auth_header} onChange={(e) => setForm({ ...form, auth_header: e.target.value })} placeholder="header auth (opcional)" className="text-xs" />
            <Input type="password" value={form.auth_value} onChange={(e) => setForm({ ...form, auth_value: e.target.value })} placeholder="valor do header (opcional)" className="text-xs" />
          </>
        )}
      </div>
      {kind === "skill" && (
        <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} placeholder="conteúdo do skill (SKILL.md) — instruções injetadas no system prompt" rows={5} className="mb-3 w-full font-mono text-xs" />
      )}
      <Button onClick={add} disabled={busy || !canAdd}><Plus className="h-4 w-4" /> Adicionar {KIND_LABEL[kind]}</Button>
      {msg && <p className={cn("mt-3 rounded-lg border p-2 text-xs", msg.ok ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger")}>{msg.text}</p>}

      <div className="mt-5 space-y-4">
        {(["mcp", "openapi", "skill"] as ToolKind[]).map((k) => (
          <div key={k}>
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">{KIND_LABEL[k]} ({byKind(k).length})</p>
            <div className="space-y-1">
              {byKind(k).map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm">
                  <span className="font-medium">{t.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted">{t.kind === "skill" ? `${t.content_len} chars` : t.kind === "openapi" ? t.spec_url : t.url}</span>
                  {t.auth_set && <Badge tone="muted">auth</Badge>}
                  <div className="ml-auto flex gap-1">
                    <Button variant="ghost" onClick={() => test(t.id)} disabled={busy}>Testar</Button>
                    <Button variant="danger" onClick={() => del(t.id)}>Remover</Button>
                  </div>
                </div>
              ))}
              {byKind(k).length === 0 && <p className="text-xs text-muted">Nenhum.</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
