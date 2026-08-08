export type TransactionType = 'rent' | 'sale';

export interface ApartmentAttributes {
  elevator?: boolean;
  parking?: boolean;
  mamad?: boolean; // Secure room
  balcony?: boolean;
  renovated?: boolean;
  furniture?: boolean;
  air_conditioning?: boolean;
  bars?: boolean; // Sorigim
  storage?: boolean; // Mahsan
  accessibility?: boolean; // Nechut
  [key: string]: boolean | undefined;
}

export interface Apartment {
  id: string;
  title: string;
  type: TransactionType;
  city: string;
  neighborhood?: string;
  address?: string;
  price: number;
  rooms: number;
  floor?: number;
  square_meters?: number;
  description?: string;
  url: string; // Direct link to Yad2 listing notice
  images: string[];
  contact_name?: string;
  contact_phone?: string;
  attributes: ApartmentAttributes;
  scraped_at: string;
  updated_at: string;
}

export interface SearchFilters {
  type?: TransactionType;
  city?: string;
  neighborhood?: string;
  street?: string;
  query?: string; // Search string in title, address, description
  min_price?: number;
  max_price?: number;
  min_rooms?: number;
  max_rooms?: number;
  min_sqm?: number;
  max_sqm?: number;
  has_elevator?: boolean;
  has_parking?: boolean;
  has_mamad?: boolean;
  has_balcony?: boolean;
  has_storage?: boolean; // Warehouse / Mahsan
  limit?: number;
  offset?: number;
}

export interface IngestPayload {
  items: Apartment[];
  purge_previous?: boolean; // If true, deletes existing apartments before ingesting new scrape run
  log?: {
    status: string;
    rent_count: number;
    sale_count: number;
    message?: string;
  };
}

export interface Env {
  DB: D1Database;
  INGEST_SECRET?: string;
  ENVIRONMENT?: string;
}
