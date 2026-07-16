import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Brain, Check, Plus, Send, ShieldAlert, Trash2, Wrench, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { CopilotConversation, CopilotDetail, Device, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Badge, Button, Card, Spinner, Textarea } from "@/components/ui";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof ApiError ? `Erro ${e.status}: ${e.message}` : String(e));

const MODES = [
  { key: "chat", label: "Chat", hint: "Só conversa, nunca executa." },
  { key: "manual", label: "Manual", hint: "Toda escrita pede aprovação." },
  { key: "auto", label: "Automático", hint: "Escreve sozinho (alto risco pede aprovação)." },
] as const;

export function Copilot() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin" || user?.role === "master";
  const [convs, setConvs] = useState<CopilotConversation[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<CopilotDetail | null>(null);

  // Nova conversa
  const [mode, setMode] = useState<"chat" | "manual" | "auto">("manual");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [starting, setStarting] = useState(false);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  // Estado ao vivo do streaming (limpo quando chega o evento "done").
  const [live, setLive] = useState<{ content: string; reasoning: string; tools: string[] } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  function loadConvs() {
    api.get<CopilotConversation[]>("/copilot/conversations").then(setConvs);
  }
  useEffect(() => {
    loadConvs();
    api.get<Device[]>("/devices").then(setDevices);
    api.get<Group[]>("/groups").then(setGroups);
  }, []);

  useEffect(() => {
    if (activeId == null) { setDetail(null); return; }
    api.get<CopilotDetail>(`/copilot/conversations/${activeId}`).then(setDetail);
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [detail, live]);

  const bySite = useMemo(() => {
    const map = new Map<number | null, Device[]>();
    for (const d of devices) {
      const k = d.group_id ?? null;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(d);
    }
    return map;
  }, [devices]);
  const siteName = (id: number | null) => groups.find((g) => g.id === id)?.name ?? "Sem site";

  function toggle(id: number) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  const allIds = devices.map((d) => d.id);

  async function start() {
    setStarting(true);
    setErr("");
    try {
      const c = await api.post<CopilotConversation>("/copilot/conversations", { mode, device_ids: [...sel] });
      loadConvs();
      setActiveId(c.id);
      setSel(new Set());
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    if (!input.trim() || activeId == null) return;
    setSending(true);
    setErr("");
    const text = input;
    setInput("");
    // Otimista: mostra a mensagem do usuário e um balão de resposta ao vivo.
    setDetail((d) => d && { ...d, messages: [...d.messages, { id: -Date.now(), role: "user", content: text, reasoning: null, tool_calls: [], name: null, created_at: new Date().toISOString() }] });
    setLive({ content: "", reasoning: "", tools: [] });
    try {
      const res = await api.postStream(`/copilot/conversations/${activeId}/stream`, { content: text });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const evLine = raw.split("\n").find((l) => l.startsWith("event:"))?.slice(6).trim() ?? "message";
          const dataLine = raw.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "{}";
          let payload: Record<string, unknown> = {};
          try { payload = JSON.parse(dataLine); } catch { /* ignora */ }
          if (evLine === "delta") setLive((l) => l && { ...l, content: l.content + (payload.text as string) });
          else if (evLine === "reasoning") setLive((l) => l && { ...l, reasoning: l.reasoning + (payload.text as string) });
          else if (evLine === "tool") setLive((l) => l && { ...l, tools: [...l.tools, payload.name as string] });
          else if (evLine === "done") { setDetail(payload as unknown as CopilotDetail); setLive(null); }
          else if (evLine === "error") setErr(String(payload.detail ?? "erro"));
        }
      }
    } catch (e) {
      setErr(errMsg(e));
      setInput(text);
    } finally {
      setLive(null);
      setSending(false);
    }
  }

  async function resolve(actionId: number, approve: boolean) {
    setSending(true);
    try {
      const d = await api.post<CopilotDetail>(`/copilot/actions/${actionId}/${approve ? "approve" : "reject"}`, {});
      setDetail(d);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setSending(false);
    }
  }

  async function delConv(id: number) {
    if (!confirm("Excluir esta conversa?")) return;
    await api.del(`/copilot/conversations/${id}`);
    if (activeId === id) setActiveId(null);
    loadConvs();
  }

  const deviceName = (id: number | null) => devices.find((d) => d.id === id)?.name ?? `device ${id}`;
  const pending = detail?.actions.filter((a) => a.status === "pending") ?? [];

  // Timeline cronológica: mensagens + ações resolvidas intercaladas por created_at.
  // (o propose_write NÃO aparece como chip — é representado pelo card de ação).
  const timeline = useMemo(() => {
    if (!detail) return [] as Array<{ ts: string; prio: number; key: string; msg?: CopilotDetail["messages"][number]; act?: CopilotDetail["actions"][number] }>;
    const items: Array<{ ts: string; prio: number; key: string; msg?: CopilotDetail["messages"][number]; act?: CopilotDetail["actions"][number] }> = [];
    for (const m of detail.messages) {
      const visible = m.role === "user" || (m.role === "assistant" && (m.content || m.reasoning || m.tool_calls.some((t) => t !== "propose_write")));
      if (visible) items.push({ ts: m.created_at, prio: 0, key: `m${m.id}`, msg: m });
    }
    for (const a of detail.actions) {
      if (a.status !== "pending") items.push({ ts: a.created_at, prio: 1, key: `a${a.id}`, act: a });
    }
    // created_at empata dentro do mesmo turno (mesma transação): mensagem antes da ação.
    items.sort((x, y) => (x.ts !== y.ts ? (x.ts < y.ts ? -1 : 1) : x.prio - y.prio || x.key.localeCompare(y.key)));
    return items;
  }, [detail]);

  return (
    <div>
      <PageHeader
        title="Copilot"
        subtitle="Assistente LLM para operar devices (Settings → LLM)"
        actions={isAdmin ? <Link to="/settings"><Button variant="ghost"><Wrench className="h-4 w-4" /> Tools (Settings)</Button></Link> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Coluna esquerda */}
        <div className="space-y-4">
          <Card>
            <h2 className="mb-2 text-sm font-semibold">Nova conversa</h2>
            <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5 text-xs">
              {MODES.map((m) => (
                <button key={m.key} onClick={() => setMode(m.key)} title={m.hint}
                  className={cn("flex-1 rounded px-2 py-1 cursor-pointer", mode === m.key ? "bg-primary/20 text-primary" : "text-muted")}>
                  {m.label}
                </button>
              ))}
            </div>
            <p className="mb-2 text-[11px] text-muted">{MODES.find((m) => m.key === mode)!.hint}</p>

            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-muted">Devices ({sel.size})</span>
              <div className="flex gap-1">
                <button onClick={() => setSel(new Set(allIds))} className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text cursor-pointer">Todos</button>
                <button onClick={() => setSel(new Set())} className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text cursor-pointer">Limpar</button>
              </div>
            </div>
            <div className="max-h-52 space-y-2 overflow-y-auto rounded-lg border border-border p-2">
              {[...bySite.entries()].map(([gid, ds]) => (
                <div key={gid ?? "none"}>
                  <p className="text-[11px] font-semibold text-muted">{siteName(gid)} ({ds.length})</p>
                  {ds.map((d) => (
                    <label key={d.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-surface-2 cursor-pointer">
                      <input type="checkbox" checked={sel.has(d.id)} onChange={() => toggle(d.id)} className="h-4 w-4 accent-primary" />
                      <span className="truncate">{d.name}</span>
                      <span className="ml-auto font-mono text-[11px] text-muted">{d.ip}</span>
                    </label>
                  ))}
                </div>
              ))}
              {devices.length === 0 && <p className="text-xs text-muted">Nenhum device.</p>}
            </div>
            <Button onClick={start} disabled={starting} className="mt-3 w-full justify-center">
              {starting ? <Spinner /> : <Plus className="h-4 w-4" />} Iniciar
            </Button>
          </Card>

          <Card>
            <h2 className="mb-2 text-sm font-semibold">Conversas</h2>
            <div className="space-y-1">
              {convs.map((c) => (
                <div key={c.id} className={cn("flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm", activeId === c.id ? "bg-primary/15" : "hover:bg-surface-2")}>
                  <button onClick={() => setActiveId(c.id)} className="min-w-0 flex-1 truncate text-left cursor-pointer">
                    {c.title}
                    <span className="ml-1 text-[10px] uppercase text-muted">{c.mode}</span>
                  </button>
                  <button onClick={() => delConv(c.id)} className="text-muted hover:text-danger cursor-pointer"><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {convs.length === 0 && <p className="text-xs text-muted">Nenhuma conversa ainda.</p>}
            </div>
          </Card>
        </div>

        {/* Coluna direita — chat */}
        <Card className="flex h-[70vh] flex-col">
          {!detail ? (
            <div className="flex flex-1 flex-col items-center justify-center text-center text-muted">
              <Bot className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-sm">Selecione ou inicie uma conversa.</p>
              <p className="mt-1 text-xs">Escolha os devices e o modo à esquerda.</p>
            </div>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2 border-b border-border pb-2">
                <Bot className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{detail.conversation.title}</span>
                <Badge tone={detail.conversation.mode === "auto" ? "accent" : "muted"}>{detail.conversation.mode}</Badge>
                <span className="ml-auto text-xs text-muted">{detail.conversation.device_ids.map(deviceName).join(", ") || "sem device"}</span>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto pr-1">
                {timeline.map((it) => it.msg ? (
                  <div key={it.key} className={cn("flex", it.msg.role === "user" ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", it.msg.role === "user" ? "bg-primary/20" : "bg-surface-2")}>
                      {it.msg.role === "assistant" && it.msg.reasoning && (
                        <details className="mb-1.5 rounded-lg border border-border/70 bg-bg/40">
                          <summary className="flex cursor-pointer select-none items-center gap-1 px-2 py-1 text-[11px] text-muted">
                            <Brain className="h-3.5 w-3.5" /> Raciocínio
                          </summary>
                          <div className="whitespace-pre-wrap px-2 pb-2 pt-1 text-[12px] italic leading-relaxed text-muted/80">{it.msg.reasoning}</div>
                        </details>
                      )}
                      {it.msg.content}
                      {(() => {
                        const chips = it.msg!.role === "assistant" ? it.msg!.tool_calls.filter((t) => t !== "propose_write") : [];
                        return chips.length > 0 ? (
                          <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
                            {chips.map((t, i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-bg px-1.5 py-0.5 font-mono"><Wrench className="h-3 w-3" />{t}</span>)}
                          </p>
                        ) : null;
                      })()}
                    </div>
                  </div>
                ) : (
                  <div key={it.key} className="rounded-lg border border-border bg-bg/40 p-2 text-xs">
                    <div className="flex items-center gap-2">
                      <Badge tone={it.act!.status === "executed" ? "ok" : it.act!.status === "rejected" ? "muted" : "danger"}>{it.act!.status}</Badge>
                      <span className="font-mono text-muted">{deviceName(it.act!.device_id)}</span>
                    </div>
                    <pre className="mt-1 overflow-x-auto font-mono text-[11px] text-text">{it.act!.command}</pre>
                    {it.act!.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted">{it.act!.output}</pre>}
                  </div>
                ))}

                {/* Balão ao vivo (streaming) */}
                {live && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl bg-surface-2 px-3 py-2 text-sm">
                      {live.reasoning && (
                        <details open className="mb-1.5 rounded-lg border border-border/70 bg-bg/40">
                          <summary className="flex cursor-pointer select-none items-center gap-1 px-2 py-1 text-[11px] text-muted"><Brain className="h-3.5 w-3.5" /> Raciocínio</summary>
                          <div className="whitespace-pre-wrap px-2 pb-2 pt-1 text-[12px] italic leading-relaxed text-muted/80">{live.reasoning}</div>
                        </details>
                      )}
                      <span className="whitespace-pre-wrap">{live.content}</span>
                      {(!live.content && !live.reasoning) && <span className="text-muted">pensando…</span>}
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
                      {live.tools.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1 text-[11px] text-muted">
                          {live.tools.map((t, i) => <span key={i} className="inline-flex items-center gap-1 rounded bg-bg px-1.5 py-0.5 font-mono"><Wrench className="h-3 w-3" />{t}</span>)}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Cards de ação pendente */}
              {pending.length > 0 && (
                <div className="mt-2 space-y-2">
                  {pending.map((a) => (
                    <div key={a.id} className={cn("rounded-lg border p-3", a.high_risk ? "border-danger/50 bg-danger/5" : "border-accent/50 bg-accent/5")}>
                      <div className="mb-1 flex items-center gap-2 text-xs">
                        {a.high_risk && <span className="inline-flex items-center gap-1 text-danger"><ShieldAlert className="h-3.5 w-3.5" /> alto risco</span>}
                        <Badge tone="accent">aguardando aprovação</Badge>
                        <span className="font-mono text-muted">{deviceName(a.device_id)}</span>
                      </div>
                      <pre className="overflow-x-auto rounded bg-bg p-2 font-mono text-xs text-text">{a.command}</pre>
                      {a.rationale && <p className="mt-1 text-xs text-muted">{a.rationale}</p>}
                      <div className="mt-2 flex gap-2">
                        <Button onClick={() => resolve(a.id, true)} disabled={sending}><Check className="h-4 w-4" /> Aprovar & executar</Button>
                        <Button variant="danger" onClick={() => resolve(a.id, false)} disabled={sending}><X className="h-4 w-4" /> Rejeitar</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {err && <p className="mt-2 rounded-lg border border-danger/40 bg-danger/10 p-2 text-xs text-danger">{err}</p>}

              <div className="mt-2 flex items-end gap-2 border-t border-border pt-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                  placeholder={pending.length ? "Resolva as ações pendentes acima…" : "Pergunte algo sobre o(s) device(s)…"}
                  rows={2}
                  className="flex-1 resize-none"
                  disabled={sending || pending.length > 0}
                />
                <Button onClick={send} disabled={sending || !input.trim() || pending.length > 0}>
                  {sending ? <Spinner /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
                <span>Contexto: <span className="font-mono text-text">{detail.conversation.tokens_context.toLocaleString("pt-BR")}</span> tokens</span>
                <span>Total usado: <span className="font-mono text-text">{detail.conversation.tokens_total.toLocaleString("pt-BR")}</span> tokens</span>
              </div>
            </>
          )}
        </Card>
      </div>

    </div>
  );
}
