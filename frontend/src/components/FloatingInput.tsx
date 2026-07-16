// Input com "floating label" estilo Facebook/Material: o label começa dentro do
// campo (como placeholder) e sobe/encolhe ao focar ou quando há texto.
//
// Truque: o <input> usa placeholder=" " (um espaço) + `peer`; o <label> reage a
// `:placeholder-shown` (campo vazio) e `:focus` do peer via variantes do Tailwind.
import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
}

export const FloatingInput = forwardRef<HTMLInputElement, Props>(function FloatingInput(
  { id, label, className, ...props },
  ref,
) {
  return (
    <div className="relative">
      <input
        id={id}
        ref={ref}
        placeholder=" "
        className={cn(
          "peer w-full rounded-xl border border-white/10 bg-black/30 px-4 pt-6 pb-2 text-sm text-white",
          "placeholder-transparent outline-none transition-colors duration-200",
          "focus:border-primary focus:ring-2 focus:ring-primary/30",
          className,
        )}
        {...props}
      />
      <label
        htmlFor={id}
        className={cn(
          "pointer-events-none absolute left-4 top-4 origin-left text-sm text-white/50 transition-all duration-200",
          // Estado flutuante: ao focar OU quando há texto (placeholder oculto).
          "peer-focus:top-2 peer-focus:text-[11px] peer-focus:text-primary",
          "peer-[:not(:placeholder-shown)]:top-2 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:text-white/60",
        )}
      >
        {label}
      </label>
    </div>
  );
});
