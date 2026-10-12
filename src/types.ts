export type TransactionType = 'rent' | 'sale';

export interface ApartmentAttributes {
  elevator?: boolean | null;
  parking?: boolean | null;
  mamad?: boolean | null; // Secure room
  balcony?: boolean | null;
  renovated?: boolean | null;
  furniture?: boolean | null;
  air_conditioning?: boolean | null;
  bars?: boolean | null; // Sorigim
  storage?: boolean | null; // Mahsan
  accessibility?: boolean | null; // Nechut
  parking_registered?: boolean | null;
  sun_terrace?: boolean | null;
  [key: string]: boolean | null | undefined;
}

export interface ApartmentDetails {
  checked_at: string;
  source_url: string;
  building_year?: number | null;
  building_kind: 'new_building' | 'renewal' | 'unknown';
  parking_type?: 'standard' | 'mechanical' | 'robotic' | null;
  built_sqm?: number | null;
  terrace_sqm?: number | null;
  entrance_date?: string | null;
  evidence: Record<string, string>;
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
  floor?: number | null;
  square_meters?: number | null;
  description?: string;
  url: string; // Direct link to Yad2 listing notice
  images: string[];
  contact_name?: string;
  contact_phone?: string;
  attributes: ApartmentAttributes;
  details?: ApartmentDetails;
  possible_duplicate_ids?: string[];
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
  has_registered_parking?: boolean;
  has_sun_terrace?: boolean;
  min_floor?: number;
  max_floor?: number;
  max_building_age?: number;
  exclude_renewal?: boolean;
  include_unknown?: boolean;
  sort_by?: 'updated' | 'floor_desc' | 'price_asc';
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
  RESEND_API_KEY?: string;
  NOTIFICATION_FROM?: string;
  NOTIFICATION_TO?: string;
  NOTIFICATION_CITIES?: string;
}
