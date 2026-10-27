/**
 * Converte erros da API em mensagens seguras para o usuário. Mensagens de
 * regras de negócio (código P0001) são escritas em português no banco e podem
 * ser exibidas; demais erros recebem texto genérico, sem detalhes internos.
 */
export interface ApiErrorLike {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
  status?: number;
}

export class ConflictError extends Error {
  constructor() {
    super('Este registro foi alterado em outro dispositivo. Os dados foram atualizados; revise e tente novamente.');
  }
}

export function friendlyError(err: unknown): string {
  if (err instanceof ConflictError) return err.message;
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sem conexão com a internet. Nenhuma alteração foi salva.';
  }
  const e = (err ?? {}) as ApiErrorLike;
  if (e.code === 'P0001' && e.message) {
    return e.hint ? `${e.message} ${e.hint}` : e.message;
  }
  switch (e.code) {
    case '23505':
      return 'Registro duplicado.';
    case '23514':
      return 'Dados inválidos. Verifique valores e datas.';
    case '23503':
      return 'Referência inválida: conta ou categoria inexistente.';
    case '42501':
      return 'Você não tem permissão para esta operação. Entre novamente.';
    case 'PGRST301':
    case 'PGRST303':
      return 'Sessão expirada. Entre novamente.';
  }
  if (e.message && /fetch|network/i.test(e.message)) {
    return 'Falha de comunicação com o servidor. Tente novamente.';
  }
  if (err instanceof Error && (err as Error & { userFacing?: boolean }).userFacing) return err.message;
  return 'Não foi possível concluir a operação. Tente novamente.';
}

export function userError(message: string): Error {
  return Object.assign(new Error(message), { userFacing: true });
}
