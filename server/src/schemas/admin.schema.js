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

/** POST /api/admin/schools/:schoolId/teachers: invite a teacher. */
export const inviteTeacherSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-invite-teacher.json',
  type: 'object',
  additionalProperties: false,
  required: ['fullName', 'email'],
  properties: {
    fullName: { type: 'string', minLength: 2, maxLength: 120, pattern: NOT_BLANK },
    email: { type: 'string', format: 'email', maxLength: 254 },
    phone: { type: 'string', pattern: '^(\\+254|0)[17]\\d{8}$' },
  },
};

const STUDENT_FIELDS = {
  fullName: { type: 'string', minLength: 2, maxLength: 120, pattern: NOT_BLANK },
  admissionNo: { type: 'string', maxLength: 40 },
  guardianPhone: { type: ['string', 'null'], maxLength: 20, pattern: '^(|(\\+254|0)[17]\\d{8})$' },
  guardianEmail: { type: ['string', 'null'], maxLength: 254, pattern: '^(|[^\\s@]+@[^\\s@]+\\.[^\\s@]+)$' },
};

/** POST /api/admin/classes/:id/students: enrol one student. */
export const enrolStudentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-enrol-student.json',
  type: 'object',
  additionalProperties: false,
  required: ['fullName'],
  properties: STUDENT_FIELDS,
};

/** POST /api/admin/classes/:id/students/import: many at once, from a CSV the admin uploaded. */
export const importStudentsSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-import-students.json',
  type: 'object',
  additionalProperties: false,
  required: ['students'],
  properties: {
    students: { type: 'array', minItems: 1, maxItems: 500, items: enrolStudentSchema },
  },
};

/** PATCH /api/admin/students/:id: edit, move to another class, remove or restore. */
export const updateStudentSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-update-student.json',
  type: 'object',
  additionalProperties: false,
  minProperties: 1,
  properties: {
    ...STUDENT_FIELDS,
    classGroupId: { type: 'string', minLength: 1, maxLength: 80 },
    active: { type: 'boolean' },
  },
};

/** POST /api/admin/scan: one card read by a scan station. */
export const stationScanSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/admin-station-scan.json',
  type: 'object',
  additionalProperties: false,
  required: ['cardUid'],
  properties: {
    cardUid: { type: 'string', minLength: 4, maxLength: 32, pattern: '^[A-Za-z0-9]+$' },
  },
};
