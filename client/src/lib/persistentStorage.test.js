import { requestPersistentStorage } from './persistentStorage';

describe('requestPersistentStorage', () => {
  it('reports unsupported when the browser has no storage manager', async () => {
    expect(await requestPersistentStorage(undefined)).toBe('unsupported');
    expect(await requestPersistentStorage({})).toBe('unsupported');
  });

  it('does not ask again when storage is already persistent', async () => {
    const persist = jest.fn();
    expect(await requestPersistentStorage({ persisted: async () => true, persist })).toBe('granted');
    expect(persist).not.toHaveBeenCalled();
  });

  it('asks, and reports what the browser decided', async () => {
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => true })).toBe('granted');
    expect(await requestPersistentStorage({ persisted: async () => false, persist: async () => false })).toBe('denied');
  });

  it('never throws', async () => {
    const broken = { persisted: async () => { throw new Error('nope'); }, persist: async () => true };
    expect(await requestPersistentStorage(broken)).toBe('unsupported');
  });
});
