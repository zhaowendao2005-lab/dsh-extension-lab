import { mkdir, realpath, lstat, writeFile, readFile, chmod } from 'node:fs/promises'
import path from 'node:path'
import { hash, uuid } from './persistence.js'
import { pathName, requireValue } from './protocol.js'

export const inside = (root, file) => file === root || file.startsWith(`${root}${path.sep}`)
export async function safeDirectory(root, relative) {
  const base = await realpath(root)
  let target = base
  for (const part of relative.split('/').filter(Boolean)) {
    requireValue(part !== '.' && part !== '..' && /^[a-zA-Z0-9_-]+$/.test(part), 'UNSAFE_DIRECTORY')
    target = path.join(target, part)
    try { await mkdir(target, { mode: 0o700 }) } catch (e) { if (e.code !== 'EEXIST') throw e }
    const stat = await lstat(target)
    requireValue(stat.isDirectory() && !stat.isSymbolicLink() && inside(base, await realpath(target)), 'UNSAFE_DIRECTORY')
  }
  return target
}

export class Artifacts {
  constructor(home) { this.home = home; this.ready = mkdir(home, { recursive: true, mode: 0o700 }).then(() => safeDirectory(home, 'delivery-artifacts')).then(root => { this.root = root }) }
  async freeze(run, unit, files, dependencies) {
    await this.ready
    const combined = new Map()
    for (const dep of dependencies) for (const file of await this.files(dep)) {
      const old = combined.get(file.path)
      requireValue(!old || old.content === file.content, 'DEPENDENCY_MANIFEST_CONFLICT')
      combined.set(file.path, file)
    }
    for (const file of files) { requireValue(!combined.has(file.path), 'DEPENDENCY_WRITE_CONFLICT'); combined.set(file.path, file) }
    const all = [...combined.values()].sort((a,b) => a.path.localeCompare(b.path))
    requireValue(all.length <= 512 && all.reduce((n,f) => n + Buffer.byteLength(f.content),0) <= 12 * 1024 * 1024, 'ARTIFACT_CLOSURE_LIMIT')
    const manifest = all.map(f => ({ path: f.path, sha256: hash(f.content), bytes: Buffer.byteLength(f.content) }))
    const dependencyDigests = dependencies.map(d => ({ id: d.id, hash: d.hash }))
    const digest = hash({ manifest, specHash: run.specHash, card: unit.card, dependencyDigests })
    const id = `candidate-${uuid()}`
    const dir = await safeDirectory(this.root, `${run.id}/${id}`)
    for (const file of all) {
      pathName(file.path)
      let parent = dir
      const parts = file.path.split('/')
      for (const p of parts.slice(0,-1)) {
        parent = path.join(parent,p)
        await mkdir(parent,{recursive:true,mode:0o700})
        requireValue(!(await lstat(parent)).isSymbolicLink() && inside(dir,await realpath(parent)), 'ARTIFACT_PATH_ESCAPE')
      }
      await writeFile(path.join(dir,file.path),file.content,{flag:'wx',mode:0o400})
    }
    const result = { id, hash:digest, contentManifestHash:hash(manifest), specHash:run.specHash, cardHash:hash(unit.card), dependencyDigests, files:manifest, directory:dir, createdAt:Date.now() }
    await writeFile(path.join(dir,'_delivery_manifest.json'),JSON.stringify(result),{flag:'wx',mode:0o400})
    await chmod(dir,0o500)
    return result
  }
  async files(candidate) {
    await this.ready
    requireValue(inside(this.root, candidate.directory) && await realpath(candidate.directory) === candidate.directory, 'ARTIFACT_ROOT_MISMATCH')
    const result = []
    for (const f of candidate.files) {
      pathName(f.path)
      const target = path.join(candidate.directory,f.path)
      const stat = await lstat(target)
      requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && inside(candidate.directory,await realpath(target)), 'ARTIFACT_INVALID_FILE')
      requireValue(stat.size === f.bytes && stat.size <= 1000000, 'ARTIFACT_SIZE_MISMATCH')
      const content = await readFile(target,'utf8')
      requireValue(hash(content) === f.sha256, 'ARTIFACT_HASH_MISMATCH')
      result.push({path:f.path,content})
    }
    return result
  }
}
