import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import type { Config } from "./types.js";

const TEMPLATE_PATH = path.resolve(process.cwd(), "prompt-template.txt");

export class ImageGenerator {
  private client: OpenAI;
  private template: string;

  constructor(config: Config) {
    this.client = new OpenAI({ apiKey: config.openaiApiKey });

    if (!fs.existsSync(TEMPLATE_PATH)) {
      throw new Error(`Prompt template not found at ${TEMPLATE_PATH}`);
    }
    this.template = fs.readFileSync(TEMPLATE_PATH, "utf-8").trim();
  }

  buildPrompt(productName: string, productDescription: string | null): string {
    let prompt = this.template;
    prompt += `\n\nProduct name: ${productName}`;
    if (productDescription) {
      const cleaned = productDescription.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      prompt += `\nProduct description: ${cleaned}`;
    }
    return prompt;
  }

  async generate(productName: string, productDescription: string | null): Promise<Buffer> {
    const prompt = this.buildPrompt(productName, productDescription);

    console.log(`  Generating image with gpt-image-1...`);

    const response = await this.client.images.generate({
      model: "gpt-image-1",
      prompt,
      size: "1024x1024",
      output_format: "png",
      n: 1,
    });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) {
      throw new Error("No image data returned from OpenAI");
    }

    return Buffer.from(b64, "base64");
  }
}
