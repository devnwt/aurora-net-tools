// Política de senha (espelha o backend em app/core/security.py):
// mínimo 6 caracteres, com letras E números.
//
// As mensagens são chaves i18n — os componentes exibem com t(...), nunca o texto
// cru. Ex.: const e = passwordError(pw); if (e) toast.error(t(e));
export const PASSWORD_MIN = 6;
/** Chave i18n do requisito de senha (use com t()). */
export const PASSWORD_HINT_KEY = "auth:password.hint";

/** Retorna a CHAVE i18n do erro se a senha for inválida, ou null se OK. */
export function passwordError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return PASSWORD_HINT_KEY;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return PASSWORD_HINT_KEY;
  return null;
}
