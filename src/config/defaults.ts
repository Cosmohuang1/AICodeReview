import { DEFAULT_EXCLUDE, parseRepoConfig, type RepoConfig } from './schema.js';

export const DEFAULT_REPO_CONFIG: RepoConfig = parseRepoConfig({});
export { DEFAULT_EXCLUDE };
