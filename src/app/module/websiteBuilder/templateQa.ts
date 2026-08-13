import httpStatus from 'http-status'
import ApiError from '../../../errors/ApiError'

type QaResult = { accessibility: string[]; responsive: string[] }

export const inspectTemplateQuality = (document: any): QaResult => {
  const accessibility: string[] = []
  const responsive: string[] = []
  const ids = new Set<string>()
  let h1Count = 0

  const walk = (nodes: any[], path: string) => {
    for (const node of nodes || []) {
      const id = String(node?.id || '')
      const label = String(node?.label || node?.type || id || 'node')
      if (!id) accessibility.push(`${path}: a block is missing a stable id`)
      else if (ids.has(id)) accessibility.push(`${path}/${label}: duplicate node id ${id}`)
      else ids.add(id)

      if (node?.type === 'image' && !String(node?.props?.alt || '').trim()) accessibility.push(`${path}/${label}: image requires descriptive alt text`)
      if (node?.type === 'heading') {
        if (!String(node?.props?.text || '').trim()) accessibility.push(`${path}/${label}: heading text cannot be empty`)
        if (Number(node?.props?.level || 2) === 1) h1Count += 1
      }
      if ((node?.type === 'button' || node?.type === 'link') && !String(node?.props?.text || node?.props?.label || '').trim()) accessibility.push(`${path}/${label}: interactive control requires an accessible label`)

      const desktop = node?.styles?.desktop || {}
      const mobile = node?.styles?.mobile || {}
      const fixedWidth = Number(desktop.width)
      if (Number.isFinite(fixedWidth) && fixedWidth > 1200 && mobile.width == null) responsive.push(`${path}/${label}: fixed desktop width ${fixedWidth}px has no mobile override`)
      const columns = Number(node?.props?.columns)
      if (Number.isFinite(columns) && columns > 4) responsive.push(`${path}/${label}: more than four requested columns is not supported responsively`)
      if (Array.isArray(node?.children)) walk(node.children, `${path}/${label}`)
    }
  }

  for (const page of document?.pages || []) walk(page.nodes || [], String(page.slug || page.id || 'page'))
  if (h1Count === 0) accessibility.push('Website must contain at least one level-1 heading')
  return { accessibility, responsive }
}

export const assertTemplateQuality = (document: any) => {
  const result = inspectTemplateQuality(document)
  const errors = [...result.accessibility, ...result.responsive]
  if (errors.length) throw new ApiError(httpStatus.BAD_REQUEST, `Template QA failed: ${errors.slice(0, 6).join('; ')}`)
  return result
}
