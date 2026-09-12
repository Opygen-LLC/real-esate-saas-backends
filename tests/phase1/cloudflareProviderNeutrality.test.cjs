const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const root = process.cwd()
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')

test('required DNS records remain backend-authoritative and provider-extensible', () => {
  const providerContract = read('src/app/module/domain/providers/domainProvider.ts')
  const lifecycle = read('src/app/module/domain/domain.service.ts')

  assert.match(providerContract, /getRequiredDns\(input: DomainProviderInput\): Promise<RequiredDnsRecord\[\]>/)
  assert.match(providerContract, /source\?: string/)
  assert.match(lifecycle, /requiredDns = await provider\.getRequiredDns\(input\)/)
  assert.match(lifecycle, /providerChanged/)
  assert.match(lifecycle, /record\?\.purpose === 'ownership' \|\| record\?\.source === 'opygen_ownership'/)
})
