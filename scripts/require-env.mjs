const missing = process.argv.slice(2).filter((name) => !process.env[name])
if (missing.length) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`)
  process.exit(1)
}
