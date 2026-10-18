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
      required: ['fullName', 'email', 'password'],
      properties: {
        fullName: { type: 'string', minLength: 2, maxLength: 120, pattern: NOT_BLANK },
        email: { type: 'string', format: 'email', maxLength: 254 },
        phone: { type: 'string', pattern: KENYAN_MOBILE },
        jobTitle: { type: 'string', maxLength: 80 },
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
