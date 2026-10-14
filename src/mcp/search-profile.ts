import { SearchFilters } from '../types';
import { normalizeCity } from '../db/queries';

export const SEARCH_CITIES = ['בת ים', 'אזור', 'חולון'];
export const SEARCH_DESCRIPTION = 'Search apartments for sale only in Bat Yam, Azor and Holon: exactly 3 rooms, floor 10 or above, elevator, sun terrace and parking. Required features must be confirmed in stored listing claims. Defaults to highest floor first. Optional filters can narrow this profile.';

export function applySearchProfile(filters: SearchFilters): SearchFilters {
  if ((filters.type !== undefined && filters.type !== 'sale')
    || (filters.city !== undefined && !SEARCH_CITIES.includes(normalizeCity(filters.city)))
    || (filters.min_rooms !== undefined && filters.min_rooms > 3)
    || (filters.max_rooms !== undefined && filters.max_rooms < 3)
    || (filters.max_floor !== undefined && filters.max_floor < 10)
    || filters.has_elevator === false || filters.has_parking === false || filters.has_sun_terrace === false
    || filters.include_unknown === true) {
    throw new Error('Search conflicts with the required sale apartment profile: Bat Yam, Azor or Holon, 3 rooms, floor 10+, elevator, sun terrace and parking; unknown required features are excluded.');
  }
  return { ...filters, type: 'sale', cities: SEARCH_CITIES,
    min_rooms: 3, max_rooms: 3, min_floor: Math.max(10, filters.min_floor ?? 10),
    has_elevator: true, has_sun_terrace: true, has_parking: true,
    include_unknown: false, sort_by: filters.sort_by ?? 'floor_desc' };
}
