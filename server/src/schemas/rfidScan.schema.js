/**
 * JSON Schema for POST /api/rfid/scan, one tap at a gate reader.
 *
 * A plain scan is just { cardUid }. A gate device adds `interactive` so the
 * server can ask it for a fingerprint, then resends with `fingerprint`.
 * A scan the device queued while the server was unreachable is replayed with
 * `offline: true`, the device's own `scannedAt` time and a `scanId` so a
 * replay that is sent twice is only recorded once.
 */

export const rfidScanSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://smartattend.example/schemas/rfid-scan.json',
  title: 'RfidScan',
  type: 'object',
  additionalProperties: false,
  required: ['cardUid'],
  properties: {
    // 4-byte (MIFARE Classic) to 10-byte UIDs as hex, any case.
    cardUid: { type: 'string', pattern: '^[0-9A-Fa-f]{8,20}$' },
    interactive: { type: 'boolean' },
    fingerprint: { type: 'string', enum: ['match', 'no_match'] },
    offline: { type: 'boolean' },
    scanId: { type: 'string', format: 'uuid' },
    scannedAt: { type: 'string', format: 'date-time' },
    deviceId: { type: 'string', minLength: 1, maxLength: 64 },
  },
  // Offline scans have no fingerprint step (the server could not ask for one)
  // and must say when they happened.
  if: { required: ['offline'], properties: { offline: { const: true } } },
  then: {
    required: ['scannedAt', 'scanId'],
    not: { required: ['fingerprint'] },
  },
};
