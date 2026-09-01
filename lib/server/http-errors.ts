type PublicHttpError = Error & { code: string; status: number };

function isPublicHttpError(error: unknown): error is PublicHttpError {
  if (!(error instanceof Error)) return false;
  const candidate = error as Partial<PublicHttpError>;
  return typeof candidate.code === 'string'
    && typeof candidate.status === 'number'
    && candidate.status >= 400
    && candidate.status < 500;
}

export function errorResponse(error: unknown): Response {
  if (isPublicHttpError(error)) {
    return Response.json({ code: error.code, message: error.message }, { status: error.status });
  }
  console.error('Household API request failed', error);
  return Response.json({ code: 'INTERNAL_ERROR', message: 'An internal error occurred.' }, { status: 500 });
}
