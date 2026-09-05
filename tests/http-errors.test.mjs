import assert from 'node:assert/strict';
import test from 'node:test';

const httpErrors = await import('../lib/server/http-errors.ts').catch(() => ({}));

test('internal Home save errors return a safe request ID and log structured D1 context', async () => {
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...values) => logged.push(values);
  try {
    const cause = new Error('D1_ERROR: too many SQL variables');
    const error = new httpErrors.InternalServerError(
      'HOME_SAVE_FAILED',
      'The Home snapshot could not be saved.',
      cause,
      {
        stage: 'replace-home-batch',
        householdId: 'hh_test',
        itemCount: 7,
        revision: 6,
      },
    );
    const request = new Request('https://wattwise.test/api/households/hh_test/home', {
      method: 'PUT',
      headers: {
        'cf-ray': 'ray-test-BKK',
        authorization: 'Bearer must-not-be-logged',
        'oai-authenticated-user-email': 'private@example.com',
      },
      body: JSON.stringify({ private: 'must-not-be-logged' }),
    });

    const response = httpErrors.errorResponse(error, { request, operation: 'household-home.put' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      code: 'HOME_SAVE_FAILED',
      message: 'The Home snapshot could not be saved.',
      requestId: 'ray-test-BKK',
    });
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0], [{
      event: 'household_api_error',
      operation: 'household-home.put',
      requestId: 'ray-test-BKK',
      stage: 'replace-home-batch',
      householdId: 'hh_test',
      itemCount: 7,
      revision: 6,
      errorName: 'InternalServerError',
      errorMessage: 'The Home snapshot could not be saved.',
      causeMessage: 'D1_ERROR: too many SQL variables',
    }]);
    assert.doesNotMatch(JSON.stringify(logged), /private@example\.com|must-not-be-logged/);
  } finally {
    console.error = originalConsoleError;
  }
});
