type PublicHttpError = Error & { code: string; status: number };

type InternalLogValue = string | number | boolean | null;
type InternalLogContext = Record<string, InternalLogValue>;

export class InternalServerError extends Error {
  readonly code: string;
  readonly status = 500;
  override readonly cause: unknown;
  readonly logContext: InternalLogContext;

  constructor(code: string, message: string, cause: unknown, logContext: InternalLogContext = {}) {
    super(message);
    this.name = 'InternalServerError';
    this.code = code;
    this.cause = cause;
    this.logContext = logContext;
  }
}

function isPublicHttpError(error: unknown): error is PublicHttpError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<PublicHttpError>;
  return typeof candidate.code === 'string'
    && typeof candidate.status === 'number'
    && candidate.status >= 400
    && candidate.status < 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function errorResponse(
  error: unknown,
  context: { request?: Request; operation?: string } = {},
): Response {
  if (isPublicHttpError(error)) {
    return Response.json({ code: error.code, message: error.message }, { status: error.status });
  }
  const requestId = context.request?.headers.get('cf-ray')?.trim() || crypto.randomUUID();
  const internal = error instanceof InternalServerError ? error : null;
  const code = internal?.code ?? 'INTERNAL_ERROR';
  const message = internal?.message ?? 'An internal error occurred.';
  console.error({
    event: 'household_api_error',
    operation: context.operation ?? 'household-api.unknown',
    requestId,
    ...internal?.logContext,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: errorMessage(error),
    causeMessage: internal ? errorMessage(internal.cause) : null,
  });
  return Response.json({ code, message, requestId }, { status: 500 });
}
