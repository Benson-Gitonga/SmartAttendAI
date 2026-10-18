import { registerSchool, getSchoolStatus, SchoolServiceError } from './schoolService';

const reply = (status, body) => jest.fn().mockResolvedValue({
  ok: status >= 200 && status < 300,
  status,
  json: () => Promise.resolve(body),
});

const DETAILS = {
  name: 'Kisumu Day Secondary School', county: 'Kisumu',
  adminName: 'Grace Achieng', adminEmail: 'g.achieng@kisumuday.ac.ke', adminPhone: null,
};

describe('registerSchool', () => {
  it('posts the details, leaving out empty ones', async () => {
    const fetchImpl = reply(201, { schoolId: 'school-1', status: 'pending' });
    const school = await registerSchool({ ...DETAILS, county: '  ' }, { fetchImpl });

    expect(school).toEqual({ schoolId: 'school-1', status: 'pending' });
    const [path, init] = fetchImpl.mock.calls[0];
    expect(path).toBe('/api/schools/register');
    expect(JSON.parse(init.body)).toEqual({
      name: DETAILS.name, adminName: DETAILS.adminName, adminEmail: DETAILS.adminEmail,
    });
  });

  it('explains a school that is already registered', async () => {
    await expect(registerSchool(DETAILS, { fetchImpl: reply(409, { status: 'active' }) }))
      .rejects.toThrow(/already registered/);
  });

  it('explains invalid details', async () => {
    await expect(registerSchool(DETAILS, { fetchImpl: reply(400, {}) })).rejects.toThrow(/not valid/);
  });

  it('explains a server that cannot be reached', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const err = await registerSchool(DETAILS, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(SchoolServiceError);
    expect(err.message).toMatch(/Could not reach/);
  });
});

describe('getSchoolStatus', () => {
  it('returns the school', async () => {
    const status = await getSchoolStatus('school-1', { fetchImpl: reply(200, { status: 'active' }) });
    expect(status).toEqual({ status: 'active' });
  });

  it('returns null for a school the server does not know', async () => {
    expect(await getSchoolStatus('nope', { fetchImpl: reply(404, {}) })).toBeNull();
  });

  it('throws on a server error', async () => {
    await expect(getSchoolStatus('school-1', { fetchImpl: reply(500, {}) })).rejects.toThrow(/500/);
  });
});
