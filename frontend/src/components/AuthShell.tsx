// Casca das telas públicas (login, cadastro, redefinição): fundo de partículas
// + marca, com o formulário alinhado à esquerda.
import type { ReactNode } from "react";
import { ParticleNetwork } from "@/components/ParticleNetwork";
import logo from "@/logo.png";

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticleNetwork />
      <div className="relative z-10 flex min-h-screen items-center px-6 sm:px-10 lg:pl-[12vw] lg:pr-10">
        <div className="w-full max-w-lg">
          <div className="mb-9 flex items-center gap-3.5">
            <img src={logo} alt="Aurora Prisma NetTools" className="h-14 w-14 rounded-xl object-contain" />
            <div>
              <h1 className="text-3xl font-semibold leading-tight tracking-tight text-white">
                Aurora Prisma{" "}
                <span className="bg-gradient-to-r from-primary via-cyan-400 to-accent bg-clip-text font-bold italic text-transparent">
                  NetTools
                </span>
              </h1>
              <p className="mt-1 text-sm text-white/50">{subtitle}</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
