declare module 'bangladesh-location-data/bangla' {
  export interface LocationItem { value: number; title: string }
  export type LocationMap = Record<string, LocationItem[]>
  export const divisions_bn: LocationItem[]
  export const districts_bn: LocationMap
  export const upazilas_bn: LocationMap
  export const unions_bn: LocationMap
}
