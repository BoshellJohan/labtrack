import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('produces a hash that is not the plain text', async () => {
    const hash = await service.hash('super-secret');
    expect(hash).not.toBe('super-secret');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('verifies a correct password', async () => {
    const hash = await service.hash('super-secret');
    await expect(service.verify('super-secret', hash)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await service.hash('super-secret');
    await expect(service.verify('wrong', hash)).resolves.toBe(false);
  });
});
