/** JSON Schemas for the school admin's writes under /api/admin. */

const DATE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const NOT_BLANK = '\\S';

/** POST /api/admin/schools/:schoolId/classes */
export const createClassSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-create-class.json',
  type: 'object',
  additionalProperties: false,
  required: ['grade'],
  properties: {
    grade: { type: 'string', minLength: 1, maxLength: 40, pattern: NOT_BLANK },
    stream: { type: 'string', maxLength: 40 },
    academicYear: { type: 'integer', minimum: 2000, maximum: 2100 },
    teacherUserId: { type: ['string', 'null'], maxLength: 80 },
  },
};

/** PATCH /api/admin/classes/:id. `teacherUserId: null` unassigns the teacher. */
export const updateClassSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-update-class.json',
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: createClassSchema.properties,
};

/**
 * PUT /api/admin/classes/:id/register: take or correct a class's register for
 * a day. A reason is always required; `note` adds detail.
 */
export const registerOverrideSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-register-override.json',
  type: 'object',
  additionalProperties: false,
  required: ['date', 'reason', 'marks'],
  properties: {
    date: DATE,
    reason: { enum: ['teacher_absent', 'wrong_mark', 'late_arrival', 'gate_error', 'other'] },
    note: { type: 'string', maxLength: 500 },
    marks: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['studentId', 'status'],
        properties: {
          studentId: { type: 'string', minLength: 1, maxLength: 80 },
          status: { enum: ['present', 'absent', 'late'] },
          absenceReason: { enum: ['fee', 'health', 'other', 'unknown'] },
        },
      },
    },
  },
  // "Other" needs the note to say what happened.
  if: { properties: { reason: { const: 'other' } } },
  then: { required: ['note'], properties: { note: { minLength: 3 } } },
};
