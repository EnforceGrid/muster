/**
 * Runtime configuration from environment variables.
 *
 * MUSTER_DOMAIN    — inbound reply domain (default: muster.example.com)
 * MUSTER_APP_NAME  — product name in prompts and CLI (default: Muster)
 */

export const musterConfig = {
  domain: process.env["MUSTER_DOMAIN"] ?? "muster.example.com",
  appName: process.env["MUSTER_APP_NAME"] ?? "Muster",
} as const;

export function replyToAddress(correlationToken: string): string {
  return `reply+${correlationToken}@${musterConfig.domain}`;
}

export function fromAddress(): string {
  return `${musterConfig.appName.toLowerCase()}@${musterConfig.domain}`;
}
