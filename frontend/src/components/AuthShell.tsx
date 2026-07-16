// Casca das telas públicas (login, cadastro, redefinição): fundo de partículas
// + marca, com o formulário alinhado à esquerda.
import type { ReactNode } from "react";
import { ParticleNetwork } from "@/components/ParticleNetwork";
import logo from "@/logo.png";

export function AuthShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <ParticleNetwork />
      <div className="relative z-10 flex min-h-screen items-center">
        <div className="w-full max-w-md px-8 sm:pl-16 sm:pr-8">
          <div className="mb-8 flex items-center gap-3">
            <img src={logo} alt="Aurora Prisma NetTools" className="h-12 w-12 rounded-lg object-contain" />
            <div>
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-white">
                Aurora Prisma{" "}
                <span className="bg-gradient-to-r from-primary via-cyan-400 to-accent bg-clip-text font-bold italic text-transparent">
                  NetTools
                </span>
              </h1>
              <p className="mt-0.5 text-sm text-white/50">{subtitle}</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
