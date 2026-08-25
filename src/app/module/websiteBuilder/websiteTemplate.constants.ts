export const WEBSITE_TEMPLATE_IDS = [
  'template-1',
  'template-2',
  'template-3',
  'template-4',
  'template-5',
  'template-6',
  'template-7',
  'template-8',
  'template-9',
  'template-10',
] as const

export type WebsiteTemplateId = (typeof WEBSITE_TEMPLATE_IDS)[number]
