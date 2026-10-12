import { searchApartments, getApartmentById, getScrapeStats, getListingHistory, getPriceDrops } from '../db/queries';
import { SearchFilters } from '../types';

export const TOOLS_MANIFEST = [
  {
    name: 'get_listing_history', description: 'Get the latest 100 observed price and core listing changes for a Yad2 ID.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'get_price_drops', description: 'Get the latest 100 price drops, optionally filtered by city (Holon, Bat Yam, Azor or Hebrew names).',
    inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  },
  {
    name: 'search_apartments',
    description: 'Search Yad2 real estate listings (rent or sale) by location, price, room count, and amenities. Returns matching apartments with price, specs, direct Yad2 link, and attributes.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['rent', 'sale'],
          description: 'Type of transaction: "rent" for apartments for rent, "sale" for apartments for sale.',
        },
        city: {
          type: 'string',
          description: 'Exact Hebrew city name, or English alias Holon, Bat Yam, Azor.',
        },
        neighborhood: {
          type: 'string',
          description: 'Neighborhood name (e.g., "פלורנטין", "מרכז העיר").',
        },
        street: {
          type: 'string',
          description: 'Street name or address filter (e.g., "אבן גבירול", "הרצל", "דיזנגוף").',
        },
        query: {
          type: 'string',
          description: 'Free text search string across title, street address, neighborhood, and description.',
        },
        min_price: {
          type: 'number',
          description: 'Minimum price in ILS (NIS).',
        },
        max_price: {
          type: 'number',
          description: 'Maximum price in ILS (NIS).',
        },
        min_rooms: {
          type: 'number',
          description: 'Minimum number of rooms (e.g., 2, 3, 4.5).',
        },
        max_rooms: {
          type: 'number',
          description: 'Maximum number of rooms.',
        },
        min_sqm: {
          type: 'number',
          description: 'Minimum size in square meters.',
        },
        max_sqm: {
          type: 'number',
          description: 'Maximum size in square meters.',
        },
        has_elevator: {
          type: 'boolean',
          description: 'Filter for apartments with elevator (מעלית).',
        },
        has_parking: {
          type: 'boolean',
          description: 'Filter for apartments with parking (חניה).',
        },
        has_mamad: {
          type: 'boolean',
          description: 'Filter for apartments with safe room (ממ"ד).',
        },
        has_balcony: {
          type: 'boolean',
          description: 'Filter for apartments with balcony (מרפסת).',
        },
        has_storage: {
          type: 'boolean',
          description: 'Filter for apartments with warehouse / storage room (מחסן).',
        },
        has_registered_parking: { type: 'boolean', description: 'Parking explicitly advertised as registered in Tabu (חניה בטאבו). Unknown is excluded unless include_unknown is true.' },
        has_sun_terrace: { type: 'boolean', description: 'An explicitly advertised sun terrace (מרפסת שמש), not any balcony.' },
        min_floor: { type: 'integer', description: 'Minimum apartment floor, inclusive.' },
        max_floor: { type: 'integer', description: 'Maximum apartment floor, inclusive.' },
        max_building_age: { type: 'integer', description: 'Maximum building age in years, based on an advertised building year/age. Apartment age is not building age.' },
        exclude_renewal: { type: 'boolean', description: 'Require a new building rather than a new apartment in an older renewed/TAMA building. Unknown is excluded in strict searches.' },
        include_unknown: { type: 'boolean', description: 'Also return candidates with unconfirmed requested features, labelled needs_verification. Explicit contradictions are still excluded. Default false.' },
        sort_by: { type: 'string', enum: ['updated', 'floor_desc', 'price_asc'], description: 'Sort by observation time, highest floor first, or lowest price first.' },
        limit: {
          type: 'number',
          description: 'Max results to return (default 20, max 100).',
        },
        offset: {
          type: 'number',
          description: 'Pagination offset.',
        },
      },
    },
  },
  {
    name: 'get_apartment_details',
    description: 'Get full details for a specific apartment listing by its ID, including direct Yad2 link, full description, images, contact phone, and amenities.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'The Yad2 listing ID or item token.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_scraping_status',
    description: 'Get status and metrics of the Yad2 scraper database, including total listing counts for rent/sale and the timestamp of the last weekly scrape execution.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

export async function handleCallTool(db: D1Database, name: string, args: any) {
  switch (name) {
    case 'get_listing_history':
      if (typeof args.id !== 'string' || !args.id) throw new Error('Listing ID is required');
      return { content: [{ type: 'text', text: JSON.stringify(await getListingHistory(db, args.id)) }] };
    case 'get_price_drops':
      return { content: [{ type: 'text', text: JSON.stringify(await getPriceDrops(db, args.city)) }] };
    case 'search_apartments': {
      const filters: SearchFilters = {
        type: args.type,
        city: args.city,
        neighborhood: args.neighborhood,
        street: args.street,
        query: args.query,
        min_price: args.min_price,
        max_price: args.max_price,
        min_rooms: args.min_rooms,
        max_rooms: args.max_rooms,
        min_sqm: args.min_sqm,
        max_sqm: args.max_sqm,
        has_elevator: args.has_elevator,
        has_parking: args.has_parking,
        has_mamad: args.has_mamad,
        has_balcony: args.has_balcony,
        has_storage: args.has_storage,
        has_registered_parking: args.has_registered_parking,
        has_sun_terrace: args.has_sun_terrace,
        min_floor: args.min_floor, max_floor: args.max_floor,
        max_building_age: args.max_building_age, exclude_renewal: args.exclude_renewal,
        include_unknown: args.include_unknown, sort_by: args.sort_by,
        limit: args.limit || 20,
        offset: args.offset || 0,
      };

      const { results, total } = await searchApartments(db, filters);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                summary: `Found ${total} total matching apartments (returning ${results.length})`,
                total,
                filters_applied: filters,
                apartments: results.map((apt) => ({
                  id: apt.id,
                  title: apt.title,
                  type: apt.type,
                  price: `${apt.price.toLocaleString()} ₪`,
                  city: apt.city,
                  neighborhood: apt.neighborhood,
                  address: apt.address,
                  rooms: apt.rooms,
                  floor: apt.floor,
                  sqm: apt.square_meters,
                  url: apt.url, // Direct link to Yad2 notice
                  attributes: apt.attributes,
                  details: apt.details || null,
                  possible_duplicate_ids: apt.possible_duplicate_ids,
                  match_status: needsVerification(apt, filters) ? 'needs_verification' : 'matches_stored_claims',
                  image_preview: apt.images[0] || null,
                  updated_at: apt.updated_at,
                })),
              },
              null,
              2
            ),
          },
        ],
      };
    }

    case 'get_apartment_details': {
      const id = String(args.id);
      const apartment = await getApartmentById(db, id);

      if (!apartment) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Apartment with ID "${id}" was not found in the database.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(apartment, null, 2),
          },
        ],
      };
    }

    case 'get_scraping_status': {
      const stats = await getScrapeStats(db);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: 'active',
                database_stats: {
                  total_apartments: stats.total_listings,
                  rent_apartments: stats.rent_listings,
                  sale_apartments: stats.sale_listings,
                  detail_enriched_apartments: stats.detail_enriched,
                  awaiting_detail_enrichment: stats.total_listings - stats.detail_enriched,
                },
                last_scrape_log: stats.last_scrape || 'No scrape logs recorded yet.',
              },
              null,
              2
            ),
          },
        ],
      };
    }

    default:
      throw new Error(`Unknown tool name: ${name}`);
  }
}

function needsVerification(apt: import('../types').Apartment, filters: SearchFilters): boolean {
  const features = { has_elevator: 'elevator', has_parking: 'parking', has_mamad: 'mamad',
    has_balcony: 'balcony', has_storage: 'storage', has_registered_parking: 'parking_registered', has_sun_terrace: 'sun_terrace' };
  return Object.entries(features).some(([filter, feature]) => filters[filter as keyof SearchFilters] !== undefined && apt.attributes[feature] == null)
    || ((filters.min_floor !== undefined || filters.max_floor !== undefined) && apt.floor == null)
    || (filters.max_building_age !== undefined && apt.details?.building_year == null)
    || (!!filters.exclude_renewal && (!apt.details || apt.details.building_kind === 'unknown'));
}
