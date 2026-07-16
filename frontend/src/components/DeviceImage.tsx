// Renderiza o PNG oficial do MikroTik conforme o board. Se não houver
// correspondência, cai no desenho sintético (DeviceIllustration).
import { deviceImageUrl } from "@/lib/deviceImage";
import { DeviceIllustration } from "./DeviceIllustration";

export function DeviceImage({ board, ports, className }: { board: string; ports?: number; className?: string }) {
  const url = deviceImageUrl(board);
  if (!url) return <DeviceIllustration model={board} ports={ports} className={className} />;
  return (
    <div className="flex w-full flex-col items-center gap-2">
      <img src={url} alt={`MikroTik ${board}`} className={className} loading="lazy" />
      <span className="font-mono text-[11px] text-muted">{board}</span>
    </div>
  );
}
