export class AuthenticationRequiredError extends Error {
  readonly code = 'AUTHENTICATION_REQUIRED';
  readonly status = 401;

  constructor() {
    super('Authentication is required.');
    this.name = 'AuthenticationRequiredError';
  }
}

export class HouseholdNotFoundError extends Error {
  readonly code = 'HOUSEHOLD_NOT_FOUND';
  readonly status = 404;
  readonly householdPublicId: string;

  constructor(householdPublicId: string) {
    super('Household was not found.');
    this.name = 'HouseholdNotFoundError';
    this.householdPublicId = householdPublicId;
  }
}

export class HouseholdForbiddenError extends Error {
  readonly code = 'HOUSEHOLD_FORBIDDEN';
  readonly status = 403;
  readonly householdPublicId: string;

  constructor(householdPublicId: string) {
    super('Household access is forbidden.');
    this.name = 'HouseholdForbiddenError';
    this.householdPublicId = householdPublicId;
  }
}
