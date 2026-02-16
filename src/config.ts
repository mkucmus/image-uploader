import "dotenv/config";
import type { Config } from "./types.js";

const required = [
  "SHOPWARE_API_URL",
  "SHOPWARE_CLIENT_ID",
  "SHOPWARE_CLIENT_SECRET",
  "OPENAI_API_KEY",
  "SALES_CHANNEL_ID",
] as const;

export function loadConfig(): Config {
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required environment variables:\n  ${missing.join("\n  ")}`);
    console.error(`\nCopy .env.example to .env and fill in the values.`);
    process.exit(1);
  }

  return {
    shopwareApiUrl: process.env.SHOPWARE_API_URL!.replace(/\/+$/, ""),
    shopwareClientId: process.env.SHOPWARE_CLIENT_ID!,
    shopwareClientSecret: process.env.SHOPWARE_CLIENT_SECRET!,
    openaiApiKey: process.env.OPENAI_API_KEY!,
    salesChannelId: process.env.SALES_CHANNEL_ID!,
  };
}
