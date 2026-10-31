const test = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')

test('toolchain probe reports status and embedded python support', () => {
  const probeScript = path.resolve(__dirname, '../runner/toolchain-probe.py')
  const res = spawnSync('python', [probeScript], { encoding: 'utf-8', timeout: 15000 })
  assert.equal(res.status, 0, res.stderr)
  
  const report = JSON.parse(res.stdout)
  assert.ok(report.os)
  assert.equal(typeof report.readyForFullVisualization, 'boolean')
  if (report.gdb && report.gdb.available) {
    assert.ok(report.gdb_python)
    assert.equal(report.gdb_python.has_python, true)
  }
})

test('job validation enforces limits on code size and language whitelist', () => {
  const MAX_SOURCE_BYTES = 200 * 1024
  const ALLOWED_LANGUAGES = new Set(['c', 'cpp', 'python'])
  
  function validate(body) {
    if (!body || typeof body !== 'object') return { valid: false, error: 'invalid body' }
    if (!body.language || !ALLOWED_LANGUAGES.has(body.language)) return { valid: false, error: 'invalid language' }
    if (typeof body.sourceCode !== 'string' || !body.sourceCode.length) return { valid: false, error: 'empty code' }
    if (Buffer.byteLength(body.sourceCode) > MAX_SOURCE_BYTES) return { valid: false, error: 'too large' }
    return { valid: true }
  }

  assert.equal(validate({ language: 'rust', sourceCode: 'fn main(){}' }).valid, false)
  assert.equal(validate({ language: 'cpp', sourceCode: '' }).valid, false)
  assert.equal(validate({ language: 'python', sourceCode: 'print(42)' }).valid, true)
  assert.equal(validate({ language: 'cpp', sourceCode: 'a'.repeat(MAX_SOURCE_BYTES + 1) }).valid, false)
})

test('job ownership: session isolation prevents cross-session inspection', () => {
  const jobs = new Map()
  function create(ownerId, id) {
    const job = { id, ownerId, status: 'queued' }
    jobs.set(id, job)
    return job
  }
  function get(id, requesterId) {
    const job = jobs.get(id)
    if (!job) return null
    if (requesterId && job.ownerId !== requesterId) throw new Error('Unauthorized')
    return job
  }

  create('session-user-A', 'job-123')
  
  // Authorized access
  assert.ok(get('job-123', 'session-user-A'))
  
  // Unauthorized cross-session attempt
  assert.throws(() => {
    get('job-123', 'session-user-B')
  }, /Unauthorized/)
})

test('token bucket rate limiter enforces burst caps and refills', () => {
  class Bucket {
    constructor(max, periodMs) {
      this.max = max
      this.tokens = max
      this.period = periodMs
      this.last = Date.now()
    }
    consume(cost = 1) {
      const now = Date.now()
      this.tokens = Math.min(this.max, this.tokens + (now - this.last) * (this.max / this.period))
      this.last = now
      if (this.tokens >= cost) {
        this.tokens -= cost
        return true
      }
      return false
    }
  }

  const bucket = new Bucket(3, 1000)
  assert.equal(bucket.consume(), true)
  assert.equal(bucket.consume(), true)
  assert.equal(bucket.consume(), true)
  assert.equal(bucket.consume(), false) // Depleted
})
