/**
 * JSON Schema for POST /api/schools/register: a school's application to join
 * SmartAttend. It carries the school's details for the system admin's review,
 * and the person applying, who becomes the school's admin account. The school
 * waits as 'pending' until a system admin approves or rejects it.
 */

const KENYAN_MOBILE = '^(\\+254|0)[17]\\d{8}$';
const NOT_BLANK = '\\S';

export const PASSWORD_MIN_LENGTH = 8;

export const schoolRegistrationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/school-registration.json',
  title: 'SchoolRegistration',
  type: 'object',
  additionalProperties: false,
  required: ['school', 'applicant'],
  properties: {
    school: {
      type: 'object',
      additionalProperties: false,
      required: ['name', 'county'],
      properties: {
        name: { type: 'string', minLength: 3, maxLength: 120, pattern: NOT_BLANK },
        county: { type: 'string', minLength: 2, maxLength: 60 },
        subCounty: { type: 'string', maxLength: 60 },
        // Ministry of Education / KNEC school code, e.g. 20414001.
        schoolCode: { type: 'string', pattern: '^[A-Za-z0-9-]{3,20}$' },
        schoolType: { enum: ['public', 'private'] },
        boarding: { enum: ['day', 'boarding', 'mixed'] },
        studentEstimate: { type: 'integer', minimum: 1, maximum: 20000 },
      },
    },
    applicant: {
      type: 'object',
      additionalProperties: false,
      required: ['fullName', 'email'],
      properties: {
        fullName: { type: 'string', minLength: 2, maxLength: 120, pattern: NOT_BLANK },
        email: { type: 'string', format: 'email', maxLength: 254 },
        phone: { type: 'string', pattern: KENYAN_MOBILE },
        jobTitle: { type: 'string', maxLength: 80 },
        // Older clients chose a password while applying. Now it is set from
        // the link emailed on approval, so it is optional.
        password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 200 },
      },
    },
  },
};

/** Body for POST /api/auth/login. */
export const signInSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/sign-in.json',
  title: 'SignIn',
  type: 'object',
  additionalProperties: false,
  required: ['email', 'password'],
  properties: {
    email: { type: 'string', minLength: 1, maxLength: 254 },
    password: { type: 'string', minLength: 1, maxLength: 200 },
  },
};

/** Body for the system admin's reject and disable actions. */
export const schoolReviewSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/school-review.json',
  title: 'SchoolReview',
  type: 'object',
  additionalProperties: false,
  properties: {
    note: { type: 'string', maxLength: 500 },
  },
};

/** POST /api/auth/setup: set a password with a one-time code from the school admin. */
export const setupCodeSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/setup-code.json',
  title: 'SetupCode',
  type: 'object',
  additionalProperties: false,
  required: ['code', 'password'],
  properties: {
    code: { type: 'string', minLength: 8, maxLength: 20 },
    password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 200 },
  },
};

/** POST /api/auth/set-password: a password from an emailed set-up or reset link. */
export const setPasswordSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/set-password.json',
  title: 'SetPassword',
  type: 'object',
  additionalProperties: false,
  required: ['token', 'password'],
  properties: {
    token: { type: 'string', minLength: 40, maxLength: 64 },
    password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 200 },
  },
};

/** POST /api/auth/verify-email and the link lookup. */
export const emailTokenSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/email-token.json',
  title: 'EmailToken',
  type: 'object',
  additionalProperties: false,
  required: ['token'],
  properties: {
    token: { type: 'string', minLength: 40, maxLength: 64 },
  },
};

/** POST /api/auth/forgot-password. */
export const forgotPasswordSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/forgot-password.json',
  title: 'ForgotPassword',
  type: 'object',
  additionalProperties: false,
  required: ['email'],
  properties: {
    email: { type: 'string', format: 'email', maxLength: 254 },
  },
};
