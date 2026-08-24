import {
  AREA_UNITS,
  PROPERTY_SPEC_FIELDS,
  PROPERTY_TYPE_FIELDS,
  defaultAreaUnitForPropertyType,
  type AreaUnit,
  type PropertySpecField,
  type PropertyType,
} from './property.constants'

const isPropertySpecField = (value: string): value is PropertySpecField =>
  (PROPERTY_SPEC_FIELDS as readonly string[]).includes(value)

export const sanitizePropertyTypePayload = <T extends Record<string, any>>(payload: T, propertyType: PropertyType): T => {
  const allowed = new Set<string>(PROPERTY_TYPE_FIELDS[propertyType].fields)
  const next = { ...payload } as Record<string, any>

  for (const key of Object.keys(next)) {
    if (isPropertySpecField(key) && !allowed.has(key)) delete next[key]
  }

  if (allowed.has('areaUnit')) {
    const allowedUnits = new Set<AreaUnit>(PROPERTY_TYPE_FIELDS[propertyType].areaUnits)
    const suppliedUnit = next.areaUnit as AreaUnit | undefined
    if (!suppliedUnit || !(AREA_UNITS as readonly string[]).includes(suppliedUnit) || !allowedUnits.has(suppliedUnit)) {
      next.areaUnit = defaultAreaUnitForPropertyType(propertyType)
    }
  } else {
    delete next.areaUnit
  }

  return next as T
}

export const disallowedPropertyTypeFields = (propertyType: PropertyType): PropertySpecField[] => {
  const allowed = new Set<string>(PROPERTY_TYPE_FIELDS[propertyType].fields)
  return PROPERTY_SPEC_FIELDS.filter((field) => !allowed.has(field))
}

export const propertyTypeUnsetDocument = (propertyType: PropertyType): Record<string, 1> =>
  Object.fromEntries(disallowedPropertyTypeFields(propertyType).map((field) => [field, 1]))
