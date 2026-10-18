/**
 * JSON Schema for POST /api/schools/register, a school admin asking for their
 * school to be added to the platform. The school waits as 'pending' until a
 * system admin approves or rejects it.
 */

export const schoolRegistrationSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/school-registration.json',
  title: 'SchoolRegistration',
  type: 'object',
  additionalProperties: false,
  required: ['name', 'adminName', 'adminEmail'],
  properties: {
    name: { type: 'string', minLength: 3, maxLength: 120, pattern: '\\S' },
    county: { type: 'string', minLength: 2, maxLength: 60 },
    adminName: { type: 'string', minLength: 2, maxLength: 120, pattern: '\\S' },
    adminEmail: { type: 'string', format: 'email', maxLength: 254 },
    // Kenyan mobile, local (07xx / 01xx) or international (+254) form.
    adminPhone: { type: 'string', pattern: '^(\\+254|0)[17]\\d{8}$' },
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
    actor: { type: 'string', maxLength: 254 },
  },
};
