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

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly status = 400;

  constructor(message = 'Request is invalid.') {
    super(message);
    this.name = 'ValidationError';
  }
}

export class StateConflictError extends Error {
  readonly code: string;
  readonly status = 409;

  constructor(code = 'STATE_CONFLICT', message = 'The requested change conflicts with current state.') {
    super(message);
    this.name = 'StateConflictError';
    this.code = code;
  }
}

export class MemberNotFoundError extends Error {
  readonly code = 'MEMBER_NOT_FOUND';
  readonly status = 404;

  constructor() {
    super('Household member was not found.');
    this.name = 'MemberNotFoundError';
  }
}
