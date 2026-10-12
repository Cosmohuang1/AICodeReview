import yaml from 'js-yaml';
import { parseRepoConfig, type RepoConfig } from './schema.js';

// 在实际项目中，content 来自 GitHub API 读取仓库文件
// 在测试中，直接传字符串
export function loadRepoConfig(yamlContent: string | null): RepoConfig {
  if (!yamlContent) {
    return parseRepoConfig({});
  }
  try {
    const raw = yaml.load(yamlContent);
    return parseRepoConfig(raw);
  } catch {
    console.warn('[ai-review] .ai-review.yml 解析失败，使用默认配置');
    return parseRepoConfig({});
  }
}
