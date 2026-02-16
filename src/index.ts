import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { loadConfig } from "./config.js";
import { ImageGenerator } from "./openai.js";
import { ShopwareClient } from "./shopware.js";
import type { ProcessingResult } from "./types.js";

const dryRun = process.argv.includes("--dry-run");
const batch = process.argv.includes("--batch");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim().toLowerCase()));
  });
}

function stripHtml(html: string | null): string {
  if (!html) return "(no description)";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

async function main() {
  console.log("=== Shopware 6 Product Image Generator ===");
  if (dryRun) console.log("[DRY RUN] Skipping image generation and upload.\n");
  else if (batch) console.log("[BATCH] Auto-generating and uploading all images.\n");
  else console.log();

  // Load config
  const config = loadConfig();
  console.log(`API URL: ${config.shopwareApiUrl}`);
  console.log(`Sales Channel: ${config.salesChannelId}\n`);

  // Authenticate
  const shopware = new ShopwareClient(config);
  console.log("Authenticating with Shopware...");
  await shopware.authenticate();
  console.log("Authenticated successfully.\n");

  // Fetch products
  console.log("Fetching products...");
  const { total, withoutImages } = await shopware.fetchAllProducts(config.salesChannelId);
  console.log(`Found ${withoutImages.length} products without images (out of ${total} total).\n`);

  if (withoutImages.length === 0) {
    console.log("All products already have images. Nothing to do!");
    rl.close();
    return;
  }

  // Dry run: just list products and exit
  if (dryRun) {
    console.log("Products without images:");
    for (let i = 0; i < withoutImages.length; i++) {
      const product = withoutImages[i];
      const name = product.translated?.name || product.name;
      const description = product.translated?.description || product.description;
      console.log(`\n  ${i + 1}. ${name}`);
      console.log(`     Number: ${product.productNumber}`);
      console.log(`     Description: ${truncate(stripHtml(description), 150)}`);
    }
    console.log("\n[DRY RUN] Done. Run without --dry-run to generate and upload images.");
    rl.close();
    return;
  }

  // Initialize image generator (only needed for real runs)
  const imageGen = new ImageGenerator(config);

  // Ensure temp directory for previews
  const tempDir = path.resolve(process.cwd(), "temp");
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const results: ProcessingResult[] = [];

  for (let i = 0; i < withoutImages.length; i++) {
    const product = withoutImages[i];
    const name = product.translated?.name || product.name;
    const description = product.translated?.description || product.description;

    const previewPath = path.join(tempDir, `${product.id}.png`);
    const hasExistingImage = fs.existsSync(previewPath);

    console.log(`\n--- Product ${i + 1}/${withoutImages.length} ---`);
    console.log(`  Name: ${name}`);
    console.log(`  Number: ${product.productNumber}`);
    console.log(`  Description: ${truncate(stripHtml(description), 200)}`);
    if (hasExistingImage) console.log(`  [Image already generated: ${previewPath}]`);

    try {
      let imageBuffer: Buffer;

      if (batch) {
        // Batch mode: use existing image or generate, then upload automatically
        if (hasExistingImage) {
          imageBuffer = Buffer.from(fs.readFileSync(previewPath));
        } else {
          console.log("  Generating image...");
          imageBuffer = await imageGen.generate(name, description);
          fs.writeFileSync(previewPath, imageBuffer);
        }
      } else {
        // Interactive mode
        imageBuffer = Buffer.alloc(0);

        if (hasExistingImage) {
          const uploadAnswer = await ask("\n  Image exists. Upload to Shopware? (y/n/r=regenerate/q=quit): ");

          if (uploadAnswer === "q") {
            console.log("\nQuitting...");
            break;
          }

          if (uploadAnswer === "r") {
            console.log("  Regenerating...");
            imageBuffer = await imageGen.generate(name, description);
            fs.writeFileSync(previewPath, imageBuffer);
            console.log(`  New image saved: ${previewPath}`);

            const confirm = await ask("  Upload this image to Shopware? (y/n): ");
            if (confirm !== "y") {
              results.push({ productId: product.id, productName: name, status: "skipped" });
              console.log("  Skipped.");
              continue;
            }
          } else if (uploadAnswer === "y") {
            imageBuffer = Buffer.from(fs.readFileSync(previewPath));
          } else {
            results.push({ productId: product.id, productName: name, status: "skipped" });
            console.log("  Skipped.");
            continue;
          }
        } else {
          const generateAnswer = await ask("\n  Generate image? (y/n/q=quit): ");

          if (generateAnswer === "q") {
            console.log("\nQuitting...");
            break;
          }

          if (generateAnswer !== "y") {
            results.push({ productId: product.id, productName: name, status: "skipped" });
            console.log("  Skipped.");
            continue;
          }

          imageBuffer = await imageGen.generate(name, description);
          fs.writeFileSync(previewPath, imageBuffer);
          console.log(`  Image saved for preview: ${previewPath}`);

          const uploadAnswer = await ask("  Upload this image to Shopware? (y/n/r=regenerate): ");

          if (uploadAnswer === "r") {
            console.log("  Regenerating...");
            imageBuffer = await imageGen.generate(name, description);
            fs.writeFileSync(previewPath, imageBuffer);
            console.log(`  New image saved: ${previewPath}`);

            const confirm = await ask("  Upload this image to Shopware? (y/n): ");
            if (confirm !== "y") {
              results.push({ productId: product.id, productName: name, status: "skipped" });
              console.log("  Skipped.");
              continue;
            }
          } else if (uploadAnswer !== "y") {
            results.push({ productId: product.id, productName: name, status: "skipped" });
            console.log("  Skipped upload.");
            continue;
          }
        }
      }

      // Upload
      console.log("  Uploading to Shopware...");
      const mediaId = await shopware.uploadMedia(imageBuffer, `ai-product-${product.id}`);
      console.log(`  Media uploaded (ID: ${mediaId}). Assigning to product...`);
      await shopware.assignMediaToProduct(product.id, mediaId);
      console.log("  Cover image assigned successfully!");
      results.push({ productId: product.id, productName: name, status: "uploaded" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ERROR: ${message}`);
      results.push({ productId: product.id, productName: name, status: "failed", error: message });
    }
  }

  // Summary
  console.log("\n=== Summary ===");
  const uploaded = results.filter((r) => r.status === "uploaded");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  console.log(`  Uploaded: ${uploaded.length}`);
  console.log(`  Skipped:  ${skipped.length}`);
  console.log(`  Failed:   ${failed.length}`);

  if (failed.length > 0) {
    console.log("\nFailed products:");
    for (const f of failed) {
      console.log(`  - ${f.productName}: ${f.error}`);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error("\nFatal error:", err);
  rl.close();
  process.exit(1);
});
