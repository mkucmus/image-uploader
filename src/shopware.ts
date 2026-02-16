import crypto from "node:crypto";
import type {
  Config,
  ShopwareAuthToken,
  ShopwareProduct,
  ShopwareSearchResponse,
} from "./types.js";

function uuid(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

export class ShopwareClient {
  private baseUrl: string;
  private accessToken: string | null = null;

  constructor(private config: Config) {
    this.baseUrl = config.shopwareApiUrl;
  }

  async authenticate(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: this.config.shopwareClientId,
        client_secret: this.config.shopwareClientSecret,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Shopware auth failed (${res.status}): ${body}`);
    }

    const data = (await res.json()) as ShopwareAuthToken;
    this.accessToken = data.access_token;
  }

  private getHeaders(): Record<string, string> {
    if (!this.accessToken) throw new Error("Not authenticated. Call authenticate() first.");
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  async fetchProductsWithoutImages(salesChannelId: string): Promise<ShopwareProduct[]> {
    const allProducts: ShopwareProduct[] = [];
    let page = 1;
    const limit = 25;

    while (true) {
      const res = await fetch(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          limit,
          page,
          filter: [
            {
              type: "equals",
              field: "visibilities.salesChannelId",
              value: salesChannelId,
            },
          ],
          associations: {
            cover: {},
            media: {},
          },
          includes: {
            product: [
              "id",
              "name",
              "description",
              "productNumber",
              "coverId",
              "cover",
              "translated",
            ],
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch products (${res.status}): ${body}`);
      }

      const data = (await res.json()) as ShopwareSearchResponse<ShopwareProduct>;
      allProducts.push(...data.data);

      if (allProducts.length >= data.total || data.data.length < limit) {
        break;
      }
      page++;
    }

    return allProducts.filter((p) => !p.coverId);
  }

  async fetchAllProducts(salesChannelId: string): Promise<{ total: number; withoutImages: ShopwareProduct[] }> {
    const allProducts: ShopwareProduct[] = [];
    let page = 1;
    const limit = 25;

    while (true) {
      const res = await fetch(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          limit,
          page,
          filter: [
            {
              type: "equals",
              field: "visibilities.salesChannelId",
              value: salesChannelId,
            },
          ],
          associations: {
            cover: {},
          },
          includes: {
            product: [
              "id",
              "name",
              "description",
              "productNumber",
              "coverId",
              "cover",
              "translated",
            ],
          },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Failed to fetch products (${res.status}): ${body}`);
      }

      const data = (await res.json()) as ShopwareSearchResponse<ShopwareProduct>;
      allProducts.push(...data.data);

      if (allProducts.length >= data.total || data.data.length < limit) {
        break;
      }
      page++;
    }

    const withoutImages = allProducts.filter((p) => !p.coverId);
    return { total: allProducts.length, withoutImages };
  }

  async uploadMedia(imageBuffer: Buffer, fileName: string): Promise<string> {
    // Step 1: Create media entity with explicit ID
    const mediaId = uuid();
    const createRes = await fetch(`${this.baseUrl}/api/media`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({ id: mediaId }),
    });

    if (!createRes.ok) {
      const body = await createRes.text();
      throw new Error(`Failed to create media entity (${createRes.status}): ${body}`);
    }

    // Step 2: Upload the actual image file
    const uploadUrl = `${this.baseUrl}/api/_action/media/${mediaId}/upload?extension=png&fileName=${encodeURIComponent(fileName)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "image/png",
        Accept: "application/json",
      },
      body: new Uint8Array(imageBuffer),
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();
      throw new Error(`Failed to upload media file (${uploadRes.status}): ${body}`);
    }

    return mediaId;
  }

  async assignMediaToProduct(productId: string, mediaId: string): Promise<void> {
    // Step 1: Create product-media association
    const assocRes = await fetch(`${this.baseUrl}/api/product-media`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        productId,
        mediaId,
      }),
    });

    if (!assocRes.ok) {
      const body = await assocRes.text();
      throw new Error(`Failed to create product-media association (${assocRes.status}): ${body}`);
    }

    const productMediaId = assocRes.headers.get("location")?.split("/").pop();
    if (!productMediaId) {
      throw new Error("Failed to get product-media ID from response");
    }

    // Step 2: Set as cover image
    const coverRes = await fetch(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      headers: this.getHeaders(),
      body: JSON.stringify({
        coverId: productMediaId,
      }),
    });

    if (!coverRes.ok) {
      const body = await coverRes.text();
      throw new Error(`Failed to set cover image (${coverRes.status}): ${body}`);
    }
  }
}
