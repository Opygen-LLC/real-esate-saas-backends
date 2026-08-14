const agencyTypeLabel = (agencyType?: string) => {
  const normalized = String(agencyType || 'residential').replace(/[_-]+/g, ' ').trim()
  return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : 'Residential'
}

export const buildDefaultWebsiteDocument = (agencyName = 'Your Agency', agencyType = 'residential') => ({
  schemaVersion: 2,
  template: { id: 'template-1', version: '2.0.0' },
  seo: {
    canonicalUrl: '',
    title: `${agencyName} | Real Estate in Bangladesh`,
    description: `Browse homes, land and commercial property with ${agencyName}.`,
    openGraph: { title: `${agencyName} | Real Estate in Bangladesh`, description: `Discover property opportunities with ${agencyName}.`, image: '' },
    robots: { index: true, follow: true },
    structuredData: { enabled: true },
  },
  pages: [{
    id: 'home',
    slug: '/',
    title: 'Home Page',
    nodes: [{
      id: 'section-hero',
      type: 'section',
      label: 'Hero Section',
      props: { fullWidth: true },
      styles: { desktop: { paddingTop: 80, paddingBottom: 80, backgroundColor: '#0f172a', textColor: '#ffffff' } },
      children: [{
        id: 'container-hero',
        type: 'container',
        label: 'Hero Container',
        props: {},
        styles: { desktop: { maxWidth: 1120, textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 } },
        children: [
          { id: 'heading-1', type: 'heading', label: 'Hero Title', props: { level: 1, text: `Find Your Next Property with ${agencyName}` }, styles: { desktop: { fontSize: 52, fontWeight: '800', textColor: '#ffffff' } } },
          { id: 'paragraph-1', type: 'paragraph', label: 'Hero Subtitle', props: { text: `${agencyTypeLabel(agencyType)} property specialists helping buyers, sellers and investors across Bangladesh.` }, styles: { desktop: { fontSize: 16, textColor: '#94a3b8' } } },
        ],
      }],
    }],
  }],
  theme: { primaryColor: '#1877F2', secondaryColor: '#0f172a', accentColor: '#1877F2', fontFamily: 'Inter' },
})
