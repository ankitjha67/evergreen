// FR-08.1/08.3 — GitHub App authentication + Octokit client factory
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

export interface AppConfig {
  appId: string;
  privateKey: string;
  webhookSecret: string;
}

export function createAppOctokit(config: AppConfig): Octokit {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: config.appId,
      privateKey: config.privateKey,
    },
  });
}

export async function getInstallationOctokit(
  appOctokit: Octokit,
  installationId: number,
): Promise<Octokit> {
  const { token } = (await appOctokit.auth({
    type: "installation",
    installationId,
  })) as { token: string };
  return new Octokit({ auth: token });
}

export async function getInstallationToken(
  appOctokit: Octokit,
  installationId: number,
): Promise<string> {
  const { token } = (await appOctokit.auth({
    type: "installation",
    installationId,
  })) as { token: string };
  return token;
}
