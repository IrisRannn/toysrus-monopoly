import { useId, useState } from "react";
import type { Employee, Team } from "../types";

interface Props {
  team: Team;
  players: Employee[];
  selectedId?: string | null;
  disabled: boolean;
  allowClear?: boolean;
  selectionLabel: string;
  onSelect: (playerId: string) => void;
}

const searchName = (name: string) => name.normalize("NFKC").trim().toLocaleLowerCase();

export default function RepresentativeSelector({
  team, players, selectedId, disabled, allowClear = true, selectionLabel, onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const id = useId();
  const members = players.filter((p) => p.team === team.id && !p.removed);
  const keyword = searchName(query);
  const matches = members.filter((p) => searchName(p.nickname).includes(keyword));
  const selected = members.find((p) => p.id === selectedId);
  const selectedOutsideSearch = selected && !matches.some((p) => p.id === selected.id);
  const status = members.length === 0
    ? "本队还没有员工加入。"
    : keyword
      ? matches.length ? `找到 ${matches.length} 位员工` : "没有匹配的员工，请换个名字搜索。"
      : `本队共 ${members.length} 位员工，可输入部分姓名查找。`;
  const optionLabel = (p: Employee) => `${p.nickname} · ${p.online ? "在线" : "离线"}`;

  return <div className="representative-selector">
    <label htmlFor={`${id}-search`}>姓名搜索</label>
    <input id={`${id}-search`} type="search" autoComplete="off"
      aria-label={`${team.name}代表姓名搜索`} aria-describedby={`${id}-status`}
      placeholder="输入姓名搜索" value={query} onChange={(e) => setQuery(e.target.value)} />
    <label htmlFor={`${id}-select`}>投骰代表</label>
    <select id={`${id}-select`} aria-label={selectionLabel} aria-describedby={`${id}-status`}
      value={selectedId || ""} disabled={disabled} onChange={(e) => onSelect(e.target.value)}>
      <option value="" disabled={!allowClear}>{selected ? "清空代表" : "请选择已加入的员工"}</option>
      {selectedOutsideSearch && <option value={selected.id}>当前代表：{optionLabel(selected)}</option>}
      {matches.map((p) => <option key={p.id} value={p.id}>{optionLabel(p)}</option>)}
    </select>
    <small id={`${id}-status`} role="status">{status}</small>
  </div>;
}
