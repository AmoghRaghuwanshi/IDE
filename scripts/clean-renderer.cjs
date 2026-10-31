const { rm } = require('node:fs/promises')
const path = require('node:path')

// Only remove the generated renderer output. Retry transient Windows file locks.
const workspace = path.resolve(__dirname, '..')
const target = path.resolve(workspace, 'out', 'renderer')
if (path.relative(workspace, target) !== path.join('out', 'renderer')) throw new Error('Unexpected build output path')
rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 }).catch(error => {
  console.error('Could not clean generated renderer output:', error.message)
  process.exitCode = 1
})
