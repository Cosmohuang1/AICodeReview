import { App } from '@octokit/app';
import { Octokit } from '@octokit/rest';

let appInstance: App | null = null;

function getApp(): App {
  if (!appInstance) {
    const privateKey = (process.env.GITHUB_PRIVATE_KEY ?? '')
      .replace(/\\n/g, '\n'); // 支持环境变量中的转义换行
    appInstance = new App({
      appId: process.env.GITHUB_APP_ID ?? '',
      privateKey,
      webhooks: { secret: process.env.GITHUB_WEBHOOK_SECRET ?? '' },
    });
  }
  return appInstance;
}

export async function getOctokit(installationId: number): Promise<Octokit> {
  const app = getApp();
  return app.getInstallationOctokit(installationId) as unknown as Octokit;
}

export function _resetApp(): void {
  appInstance = null;
}
