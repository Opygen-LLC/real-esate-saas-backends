export const tenantRefPopulate = (
  path: string,
  select: string,
  organizationId: string,
  extraMatch: Record<string, unknown> = {},
) => ({
  path,
  select,
  match: { organizationId, ...extraMatch },
})

export const tenantRefPopulates = (
  paths: string[],
  select: string,
  organizationId: string,
  extraMatch: Record<string, unknown> = {},
) => paths.map((path) => tenantRefPopulate(path, select, organizationId, extraMatch))
