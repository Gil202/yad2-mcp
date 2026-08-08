import { z } from 'zod';
import { searchApartments, getApartmentById, getScrapeStats } from '../db/queries';
import { SearchFilters } from '../types';

export const TOOLS_MANIFEST = [
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
          description: 'City name in Hebrew or English (e.g., "תל אביב יפו", "חיפה", "ירושלים", "רמת גן").',
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
