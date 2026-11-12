import { readFile, readdir } from 'node:fs/promises'
import { getPool, closeDatabase } from './store.js'

try {
  const dir = new URL('../migrations/', import.meta.url)
  const files = (await readdir(dir)).filter(name => name.endsWith('.sql')).sort()
  const pool = await getPool()
  for (const file of files) {
    const script = await readFile(new URL(file, dir), 'utf8')
    await pool.request().batch(script)
    console.log(`Đã áp dụng migration: ${file}`)
  }
  console.log('Migration hoàn tất; dữ liệu hiện có được giữ lại.')
} catch (error) {
  console.error('Migration thất bại:', error.code || error.name, error.message)
  process.exitCode = 1
} finally {
  await closeDatabase()
}
