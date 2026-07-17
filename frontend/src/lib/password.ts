// Política de senha (espelha o backend em app/core/security.py):
// mínimo 6 caracteres, com letras E números.
export const PASSWORD_MIN = 6;
export const PASSWORD_HINT = `Mínimo ${PASSWORD_MIN} caracteres, com letras e números.`;

/** Retorna a mensagem de erro se a senha for inválida, ou null se OK. */
export function passwordError(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return PASSWORD_HINT;
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return PASSWORD_HINT;
  return null;
}
