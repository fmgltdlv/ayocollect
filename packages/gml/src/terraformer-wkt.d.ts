declare module '@terraformer/wkt' {
  export function wktToGeoJSON(wkt: string): { type: string; coordinates: unknown };
}
