import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetInstallationOctokit = vi.fn().mockReturnValue({ pulls: {} });
const MockApp = vi.fn().mockImplementation(() => ({
  getInstallationOctokit: mockGetInstallationOctokit,
}));

vi.mock('@octokit/app', () => ({
  App: MockApp,
}));

describe('getOctokit', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  it('creates App with processed private key and returns installation Octokit', async () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_PRIVATE_KEY = '-----BEGIN RSA-----\\nline1\\nline2\\n-----END RSA-----';
    process.env.GITHUB_WEBHOOK_SECRET = 'secret123';

    const { getOctokit } = await import('../../src/github/octokit.js');
    const octokit = await getOctokit(999);

    expect(MockApp).toHaveBeenCalledWith({
      appId: '12345',
      privateKey: '-----BEGIN RSA-----\nline1\nline2\n-----END RSA-----',
      webhooks: { secret: 'secret123' },
    });
    expect(mockGetInstallationOctokit).toHaveBeenCalledWith(999);
    expect(octokit).toBeDefined();
  });

  it('reuses existing App instance on subsequent getOctokit calls', async () => {
    process.env.GITHUB_APP_ID = '12345';
    process.env.GITHUB_PRIVATE_KEY = 'key';

    const { getOctokit } = await import('../../src/github/octokit.js');
    await getOctokit(100);
    await getOctokit(200);

    expect(MockApp).toHaveBeenCalledTimes(1);
    expect(mockGetInstallationOctokit).toHaveBeenCalledWith(100);
    expect(mockGetInstallationOctokit).toHaveBeenCalledWith(200);
  });
});
