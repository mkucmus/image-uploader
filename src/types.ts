export interface Config {
  shopwareApiUrl: string;
  shopwareClientId: string;
  shopwareClientSecret: string;
  openaiApiKey: string;
  salesChannelId: string;
}

export interface ShopwareAuthToken {
  access_token: string;
  expires_in: number;
}

export interface ShopwareProduct {
  id: string;
  name: string;
  description: string | null;
  productNumber: string;
  coverId: string | null;
  cover: ShopwareMedia | null;
  translated: {
    name: string;
    description: string | null;
  };
}

export interface ShopwareMedia {
  id: string;
  url: string;
  fileName: string;
  mimeType: string;
}

export interface ShopwareSearchResponse<T> {
  total: number;
  data: T[];
}

export interface ProcessingResult {
  productId: string;
  productName: string;
  status: "uploaded" | "skipped" | "failed";
  error?: string;
}
