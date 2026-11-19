// Writing places (chapters, plans and ideas on the Lore Map). Who gets a place's point is decided in
// lib/access.ts (placeFor); this file only turns inputs into columns.
import { PLACE_PRECISIONS, type PlaceInput, type PlacePoint, type PlacePrecision } from '#shared';

export interface PlaceColumns {
  locationName?: string | null;
  lat?: number | null;
  lon?: number | null;
  placePrecision?: PlacePrecision;
}

/**
 * The columns a `place` input sets: left out → nothing; null → no point and no name (the precision
 * stays, so a later place keeps a private choice), but a `locationName` given in the same request
 * stays ("the cabin" without a pin); an object → its name and point, and its precision when given
 * (else the column's default on create, the current one on update).
 */
export function placeColumns(place: PlaceInput | null | undefined, locationName?: string | null): PlaceColumns {
  if (place === undefined) return {};
  if (place === null) return locationName === undefined ? { locationName: null, lat: null, lon: null } : { lat: null, lon: null };
  return {
    locationName: place.name,
    lat: place.lat,
    lon: place.lon,
    ...(place.precision ? { placePrecision: place.precision } : {}),
  };
}

/** The more private of two precisions (exact < approximate < only_me). */
export const stricter = (a: PlacePrecision, b: PlacePrecision): PlacePrecision =>
  PLACE_PRECISIONS.indexOf(a) >= PLACE_PRECISIONS.indexOf(b) ? a : b;

/**
 * A place carried from one item to the one made of it (idea → plan, plan → chapter): only the point
 * the maker may have (placeFor), never more private than it was, nor than `floor`.
 */
export function carriedPlace(point: PlacePoint | null, floor: PlacePrecision): PlaceColumns {
  if (!point) return {};
  return { lat: point.lat, lon: point.lon, placePrecision: stricter(point.precision, floor) };
}
