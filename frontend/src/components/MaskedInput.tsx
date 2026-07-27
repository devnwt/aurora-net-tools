import { type InputHTMLAttributes } from "react";
import { Input } from "@/components/ui";
import { MASKS, type MaskName } from "@/lib/masks";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  mask: MaskName;
  value: string;
  /** Recebe o valor JÁ formatado — o mesmo texto que a API espera. */
  onValueChange: (value: string) => void;
};

/**
 * Input com máscara de apresentação, sobre o mesmo `Input` base (herda estilo,
 * foco, etc.). A formatação acontece no onChange: o pai recebe por
 * `onValueChange` o valor já mascarado, então nada muda na submissão/persistência.
 */
export function MaskedInput({ mask, value, onValueChange, inputMode, ...props }: Props) {
  const spec = MASKS[mask];
  return (
    <Input
      {...props}
      value={value}
      inputMode={inputMode ?? spec.inputMode}
      onChange={(e) => onValueChange(spec.apply(e.target.value))}
    />
  );
}
