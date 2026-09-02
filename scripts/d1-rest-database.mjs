const API_ORIGIN = 'https://api.cloudflare.com/client/v4';

export function createD1RestDatabase({ accountId, databaseId, apiToken, fetch: request = fetch }) {
  for (const [name, value] of Object.entries({ accountId, databaseId, apiToken })) {
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} is required.`);
  }
  const endpoint = `${API_ORIGIN}/accounts/${encodeURIComponent(accountId)}/d1/database/${encodeURIComponent(databaseId)}/query`;

  const query = async (body) => {
    const response = await request(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`D1 administrative request failed with HTTP ${response.status}.`);
    }
    const results = Array.isArray(payload?.result) ? payload.result : [];
    const failedResult = results.find((result) => result?.success !== true);
    if (!response.ok || payload?.success !== true || failedResult) {
      const messages = Array.isArray(payload?.errors)
        ? payload.errors.map(({ message }) => message).filter(Boolean).join('; ')
        : '';
      throw new Error(`D1 administrative request failed with HTTP ${response.status}${messages ? `: ${messages}` : '.'}`);
    }
    return results;
  };

  const prepare = (sql, params = []) => ({
    sql,
    params,
    bind: (...values) => prepare(sql, values),
    all: async () => (await query({ sql, params }))[0],
    run: async () => (await query({ sql, params }))[0],
  });

  return {
    prepare,
    batch: async (statements) => query({
      batch: statements.map(({ sql, params }) => ({ sql, params })),
    }),
  };
}
