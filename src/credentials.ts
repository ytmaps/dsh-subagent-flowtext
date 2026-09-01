import { randomUUID } from 'node:crypto'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Persistence boundary for a FlowText Gateway credential. */
export interface FlowTextCredentialStore {
  load(baseUrl: string): Promise<string | undefined>
  save(baseUrl: string, token: string): Promise<void>
  clear(baseUrl: string): Promise<void>
}

interface CredentialFile {
  readonly version: 1
  readonly baseUrl: string
  readonly token: string
}

function defaultCredentialPath(): string {
  const dshHome = process.env.DSH_HOME?.trim()
  const root = dshHome ? resolve(dshHome) : join(homedir(), '.dsh')
  return join(root, 'credentials', 'dsh-subagent-flowtext.json')
}

function validToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 24 && value.length <= 4096
}

/** Mode-0600 local credential file, separate from profile configuration and repositories. */
export class FileCredentialStore implements FlowTextCredentialStore {
  readonly path: string

  constructor(path = defaultCredentialPath()) {
    this.path = resolve(path)
  }

  async load(baseUrl: string): Promise<string | undefined> {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8')) as Partial<CredentialFile>
      return value.version === 1 && value.baseUrl === baseUrl && validToken(value.token)
        ? value.token
        : undefined
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      return undefined
    }
  }

  async save(baseUrl: string, token: string): Promise<void> {
    if (!validToken(token)) throw new Error('subagent-flowtext: paired token is invalid')
    const directory = dirname(this.path)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    const payload: CredentialFile = { version: 1, baseUrl, token }
    try {
      await writeFile(temporary, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
      await chmod(this.path, 0o600)
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      throw error
    }
  }

  async clear(baseUrl: string): Promise<void> {
    const current = await this.load(baseUrl)
    if (current === undefined) return
    await unlink(this.path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    })
  }
}

