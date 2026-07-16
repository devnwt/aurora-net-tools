import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { AppUser, Device, Group, Rack, RackLink, UserGroup } from "@/lib/types";
import { ForceGraph, type GEdge, type GNode } from "@/components/ForceGraph";
import { PageHeader } from "@/components/PageHeader";
import { Button, Card, EmptyState, Input, Select, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const COLOR: Record<string, string> = {
  site: "#3B82F6",
  rack: "#F59E0B",
  device: "#22C55E",
  usergroup: "#A855F7",
  user: "#22D3EE",
};

export function Racks() {
  const { confirm, alert } = useConfirm();
  const { user: me } = useAuth();
  const isAdmin = me?.role === "admin" || me?.role === "master";

  const [sites, setSites] = useState<Group[]>([]);
  const [racks, setRacks] = useState<Rack[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [links, setLinks] = useState<RackLink[]>([]);
  const [ugroups, setUgroups] = useState<UserGroup[]>([]);
  const [members, setMembers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);

  const [rackForm, setRackForm] = useState({ site_id: "", name: "" });
  const [linkForm, setLinkForm] = useState({ rack_a_id: "", iface_a: "", rack_b_id: "", iface_b: "" });
  const [ugForm, setUgForm] = useState({ name: "", parent_id: "" });
  const [busy, setBusy] = useState(false);

  function reload() {
    const base = [
      api.get<Group[]>("/groups"),
      api.get<Rack[]>("/racks"),
      api.get<Device[]>("/devices"),
      api.get<RackLink[]>("/rack-links"),
    ] as const;
    const extra = isAdmin
      ? [api.get<UserGroup[]>("/user-groups"), api.get<AppUser[]>("/users")]
      : [Promise.resolve([] as UserGroup[]), Promise.resolve([] as AppUser[])];
    Promise.all([...base, ...extra])
      .then(([s, r, d, l, ug, us]) => {
        setSites(s as Group[]);
        setRacks(r as Rack[]);
        setDevices(d as Device[]);
        setLinks(l as RackLink[]);
        setUgroups(ug as UserGroup[]);
        setMembers(us as AppUser[]);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [isAdmin]);

  const siteName = (id: number) => sites.find((s) => s.id === id)?.name ?? `Site ${id}`;
  const rackName = (id: number) => racks.find((r) => r.id === id)?.name ?? `Rack ${id}`;

  const { nodes, edges } = useMemo(() => {
    const nodes: GNode[] = [];
    const edges: GEdge[] = [];
    sites.forEach((s) => nodes.push({ id: `site-${s.id}`, label: s.name, type: "site" }));
    racks.forEach((r) => {
      nodes.push({ id: `rack-${r.id}`, label: r.name, type: "rack" });
      edges.push({ source: `site-${r.site_id}`, target: `rack-${r.id}`, kind: "contains" });
    });
    devices.forEach((d) => {
      nodes.push({ id: `device-${d.id}`, label: d.name, type: "device" });
      if (d.rack_id) edges.push({ source: `rack-${d.rack_id}`, target: `device-${d.id}`, kind: "contains" });
      else if (d.group_id) edges.push({ source: `site-${d.group_id}`, target: `device-${d.id}`, kind: "contains" });
    });
    links.forEach((l) => edges.push({ source: `rack-${l.rack_a_id}`, target: `rack-${l.rack_b_id}`, kind: "link", label: `${l.iface_a || "?"} ↔ ${l.iface_b || "?"}` }));
    const ugIds = new Set(ugroups.map((g) => g.id));
    ugroups.forEach((g) => {
      nodes.push({ id: `ug-${g.id}`, label: g.name, type: "usergroup" });
      if (g.parent_id && ugIds.has(g.parent_id)) edges.push({ source: `ug-${g.parent_id}`, target: `ug-${g.id}`, kind: "contains" });
    });
    members.forEach((u) => {
      nodes.push({ id: `user-${u.id}`, label: u.username, type: "user" });
      if (u.usergroup_id && ugIds.has(u.usergroup_id)) edges.push({ source: `ug-${u.usergroup_id}`, target: `user-${u.id}`, kind: "contains" });
    });
    return { nodes, edges };
  }, [sites, racks, devices, links, ugroups, members]);

  async function addRack() {
    if (!rackForm.site_id || !rackForm.name) return;
    setBusy(true);
    try {
      await api.post("/racks", { site_id: Number(rackForm.site_id), name: rackForm.name });
      setRackForm({ site_id: rackForm.site_id, name: "" });
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function delRack(r: Rack) {
    if (!(await confirm({ title: "Excluir rack", message: `Excluir o rack "${r.name}"? Os devices ficam sem rack.` }))) return;
    await api.del(`/racks/${r.id}`);
    reload();
  }
  async function assign(deviceId: number, rackId: string) {
    await api.patch(`/devices/${deviceId}`, { rack_id: rackId ? Number(rackId) : null });
    reload();
  }
  async function addLink() {
    if (!linkForm.rack_a_id || !linkForm.rack_b_id) return;
    setBusy(true);
    try {
      await api.post("/rack-links", {
        rack_a_id: Number(linkForm.rack_a_id),
        rack_b_id: Number(linkForm.rack_b_id),
        iface_a: linkForm.iface_a,
        iface_b: linkForm.iface_b,
      });
      setLinkForm({ rack_a_id: "", iface_a: "", rack_b_id: "", iface_b: "" });
      reload();
    } catch (e) {
      await alert({ title: "Erro", message: String(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  async function delLink(l: RackLink) {
    await api.del(`/rack-links/${l.id}`);
    reload();
  }
  async function addUgroup() {
    if (!ugForm.name) return;
    setBusy(true);
    try {
      await api.post("/user-groups", { name: ugForm.name, parent_id: ugForm.parent_id ? Number(ugForm.parent_id) : null });
      setUgForm({ name: "", parent_id: "" });
      reload();
    } catch (e) {
      await alert({ title: "Erro", message: String(e), tone: "danger" });
    } finally {
      setBusy(false);
    }
  }
  async function delUgroup(g: UserGroup) {
    if (!(await confirm({ title: "Excluir grupo", message: `Excluir o grupo "${g.name}"? Os usuários ficam sem grupo.` }))) return;
    await api.del(`/user-groups/${g.id}`);
    reload();
  }
  async function assignUser(userId: number, ugId: string) {
    await api.patch(`/users/${userId}`, { usergroup_id: ugId ? Number(ugId) : null });
    reload();
  }

  if (loading) return <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>;

  return (
    <div>
      <PageHeader title="Racks & Mapa" subtitle="Site → Rack → Device e ligações entre racks" />

      <Card className="mb-5">
        <div className="mb-2 flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5"><Dot c={COLOR.site} /> Site</span>
          <span className="inline-flex items-center gap-1.5"><Dot c={COLOR.rack} /> Rack</span>
          <span className="inline-flex items-center gap-1.5"><Dot c={COLOR.device} /> Device</span>
          {isAdmin && <span className="inline-flex items-center gap-1.5"><Dot c={COLOR.usergroup} /> Grupo</span>}
          {isAdmin && <span className="inline-flex items-center gap-1.5"><Dot c={COLOR.user} /> Usuário</span>}
          <span className="ml-auto">arraste os nós</span>
        </div>
        {nodes.length === 0 ? (
          <EmptyState title="Sem estrutura" hint="Crie um site, racks e atribua devices para ver o grafo." />
        ) : (
          <ForceGraph nodes={nodes} edges={edges} color={(n) => COLOR[n.type] ?? "#94A3B8"} />
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Racks por site */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Racks</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <Select value={rackForm.site_id} onChange={(e) => setRackForm({ ...rackForm, site_id: e.target.value })} className="w-40">
              <option value="">— site —</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Input value={rackForm.name} onChange={(e) => setRackForm({ ...rackForm, name: e.target.value })} placeholder="nome do rack" className="max-w-[160px]" />
            <Button onClick={addRack} disabled={busy || !rackForm.site_id || !rackForm.name}><Plus className="h-4 w-4" /> Adicionar</Button>
          </div>
          {sites.length === 0 && <p className="text-xs text-muted">Crie um Site primeiro (menu Sites).</p>}
          {sites.map((s) => {
            const rs = racks.filter((r) => r.site_id === s.id);
            if (rs.length === 0) return null;
            return (
              <div key={s.id} className="mb-2">
                <p className="text-xs font-semibold text-muted">{s.name}</p>
                <div className="mt-1 space-y-1">
                  {rs.map((r) => (
                    <div key={r.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm">
                      <span>{r.name} <span className="text-xs text-muted">({devices.filter((d) => d.rack_id === r.id).length} devices)</span></span>
                      <Button variant="danger" onClick={() => delRack(r)}>Excluir</Button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Card>

        {/* Atribuir devices a racks */}
        <Card>
          <h2 className="mb-3 text-sm font-semibold">Devices → Rack</h2>
          {devices.length === 0 ? (
            <p className="text-xs text-muted">Nenhum device.</p>
          ) : (
            <div className="space-y-1">
              {devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{d.name} <span className="font-mono text-xs text-muted">{d.ip}</span></span>
                  <Select value={d.rack_id ? String(d.rack_id) : ""} onChange={(e) => assign(d.id, e.target.value)} className="w-44">
                    <option value="">— sem rack —</option>
                    {racks.map((r) => <option key={r.id} value={r.id}>{r.name} · {siteName(r.site_id)}</option>)}
                  </Select>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Ligações entre racks */}
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Ligações entre racks</h2>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={linkForm.rack_a_id} onChange={(e) => setLinkForm({ ...linkForm, rack_a_id: e.target.value })} className="w-40">
              <option value="">— rack A —</option>
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Input value={linkForm.iface_a} onChange={(e) => setLinkForm({ ...linkForm, iface_a: e.target.value })} placeholder="iface A (ex.: ether5)" className="max-w-[150px] font-mono" />
            <span className="text-muted">↔</span>
            <Select value={linkForm.rack_b_id} onChange={(e) => setLinkForm({ ...linkForm, rack_b_id: e.target.value })} className="w-40">
              <option value="">— rack B —</option>
              {racks.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </Select>
            <Input value={linkForm.iface_b} onChange={(e) => setLinkForm({ ...linkForm, iface_b: e.target.value })} placeholder="iface B (ex.: ether1)" className="max-w-[150px] font-mono" />
            <Button onClick={addLink} disabled={busy || !linkForm.rack_a_id || !linkForm.rack_b_id}><Plus className="h-4 w-4" /> Ligar</Button>
          </div>
          {links.length === 0 ? (
            <p className="text-xs text-muted">Sem ligações.</p>
          ) : (
            <div className="space-y-1">
              {links.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm">
                  <span className="font-mono text-xs">
                    {rackName(l.rack_a_id)} <span className="text-accent">{l.iface_a || "?"}</span> ↔ <span className="text-accent">{l.iface_b || "?"}</span> {rackName(l.rack_b_id)}
                  </span>
                  <Button variant="danger" onClick={() => delLink(l)}>Excluir</Button>
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Grupos de usuários (admin/master) */}
        {isAdmin && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Grupos de usuários</h2>
            <div className="mb-3 flex flex-wrap gap-2">
              <Input value={ugForm.name} onChange={(e) => setUgForm({ ...ugForm, name: e.target.value })} placeholder="nome do grupo" className="max-w-[160px]" />
              <Select value={ugForm.parent_id} onChange={(e) => setUgForm({ ...ugForm, parent_id: e.target.value })} className="w-40">
                <option value="">— sem pai —</option>
                {ugroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </Select>
              <Button onClick={addUgroup} disabled={busy || !ugForm.name}><Plus className="h-4 w-4" /> Adicionar</Button>
            </div>
            {ugroups.length === 0 ? (
              <p className="text-xs text-muted">Nenhum grupo. Crie grupos aninháveis para organizar usuários.</p>
            ) : (
              <div className="space-y-1">
                {ugroups.map((g) => (
                  <div key={g.id} className="flex items-center justify-between rounded-lg border border-border px-3 py-1.5 text-sm">
                    <span>
                      {g.name}
                      {g.parent_id && <span className="text-xs text-muted"> ⊂ {ugroups.find((p) => p.id === g.parent_id)?.name ?? g.parent_id}</span>}
                      <span className="text-xs text-muted"> ({members.filter((u) => u.usergroup_id === g.id).length} usuários)</span>
                    </span>
                    <Button variant="danger" onClick={() => delUgroup(g)}>Excluir</Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Atribuir usuários a grupos (admin/master) */}
        {isAdmin && (
          <Card>
            <h2 className="mb-3 text-sm font-semibold">Usuários → Grupo</h2>
            {members.length === 0 ? (
              <p className="text-xs text-muted">Nenhum usuário.</p>
            ) : (
              <div className="space-y-1">
                {members.map((u) => (
                  <div key={u.id} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{u.username} <span className="text-xs text-muted">{u.role}</span></span>
                    <Select value={u.usergroup_id ? String(u.usergroup_id) : ""} onChange={(e) => assignUser(u.id, e.target.value)} className="w-44">
                      <option value="">— sem grupo —</option>
                      {ugroups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Dot({ c }: { c: string }) {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />;
}
