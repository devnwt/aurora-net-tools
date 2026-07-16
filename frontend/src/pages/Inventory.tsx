import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Device, Group } from "@/lib/types";
import { PageHeader } from "@/components/PageHeader";
import { Table, Td, Th } from "@/components/Table";
import { Badge, Button, EmptyState, Select, Spinner } from "@/components/ui";
import { useConfirm } from "@/lib/confirm";

const typeTone = { routeros: "primary", cisco: "accent", huawei: "ok" } as const;

export function Inventory() {
  const { confirm } = useConfirm();
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState("");

  function load() {
    Promise.all([api.get<Device[]>("/devices"), api.get<Group[]>("/groups")])
      .then(([d, g]) => {
        setDevices(d);
        setGroups(g);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function remove(id: number, name: string) {
    if (!(await confirm({ title: "Excluir equipamento", message: `Excluir o equipamento "${name}"?` }))) return;
    await api.del(`/devices/${id}`);
    load();
  }

  const groupName = useMemo(() => Object.fromEntries(groups.map((g) => [g.id, g.name])), [groups]);
  const filtered = devices.filter(
    (d) =>
      (!typeFilter || d.device_type === typeFilter) &&
      (!groupFilter || String(d.group_id) === groupFilter),
  );

  return (
    <div>
      <PageHeader
        title="Inventário"
        subtitle={`${devices.length} equipamentos`}
        actions={
          <Link to="/devices/new">
            <Button><Plus className="h-4 w-4" /> Novo equipamento</Button>
          </Link>
        }
      />
      <div className="mb-4 flex flex-wrap gap-3">
        <Select className="w-44" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Filtrar por tipo">
          <option value="">Todos os tipos</option>
          <option value="routeros">RouterOS</option>
          <option value="cisco">Cisco</option>
          <option value="huawei">Huawei</option>
        </Select>
        <Select className="w-52" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)} aria-label="Filtrar por grupo">
          <option value="">Todos os grupos</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Spinner className="h-6 w-6" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState title="Nenhum equipamento" hint="Cadastre um device para começar a diagnosticar." />
      ) : (
        <Table
          head={
            <>
              <Th>Nome</Th>
              <Th>IP</Th>
              <Th>Tipo</Th>
              <Th>Grupo</Th>
              <Th>Acessos</Th>
              <Th />
            </>
          }
        >
          {filtered.map((d) => (
            <tr key={d.id} className="hover:bg-surface-2 transition-colors duration-200">
              <Td className="font-medium">{d.name}</Td>
              <Td className="font-mono text-muted">{d.ip}</Td>
              <Td><Badge tone={typeTone[d.device_type]}>{d.device_type}</Badge></Td>
              <Td className="text-muted">{d.group_id ? groupName[d.group_id] ?? "—" : "—"}</Td>
              <Td>
                <div className="flex gap-1">
                  {d.ssh_enabled && <Badge>SSH</Badge>}
                  {d.telnet_enabled && <Badge>Telnet</Badge>}
                  {d.snmp_enabled && <Badge>SNMP</Badge>}
                  {d.api_enabled && <Badge>API</Badge>}
                </div>
              </Td>
              <Td className="text-right">
                <div className="flex items-center justify-end gap-2">
                  <Link to={`/devices/${d.id}`} className="text-primary hover:underline cursor-pointer">Console</Link>
                  <Link to={`/devices/${d.id}/edit`}>
                    <Button variant="ghost">Editar</Button>
                  </Link>
                  <Button variant="danger" onClick={() => remove(d.id, d.name)}>Excluir</Button>
                </div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
