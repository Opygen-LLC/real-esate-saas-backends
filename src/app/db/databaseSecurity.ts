import mongoose from 'mongoose'
import config from '../../config'

const PRIVILEGED_RUNTIME_ROLES = new Set([
  'root',
  'dbOwner',
  'dbAdmin',
  'dbAdminAnyDatabase',
  'userAdmin',
  'userAdminAnyDatabase',
  'readWriteAnyDatabase',
  'clusterAdmin',
  'clusterManager',
  'hostManager',
  'atlasAdmin',
])

type AuthenticatedRole = { role?: string; db?: string }

export const assertMongoRuntimeSecurity = async (): Promise<void> => {
  if (!config.isProduction) return
  const db = mongoose.connection.db
  if (!db) throw new Error('MongoDB connection is unavailable for production security verification')

  const status: any = await db.admin().command({ connectionStatus: 1, showPrivileges: false })
  const users = Array.isArray(status?.authInfo?.authenticatedUsers) ? status.authInfo.authenticatedUsers : []
  const roles: AuthenticatedRole[] = Array.isArray(status?.authInfo?.authenticatedUserRoles)
    ? status.authInfo.authenticatedUserRoles
    : []

  if (!users.length) throw new Error('Production MongoDB connection must use an authenticated application user')
  const privileged = roles.find((entry) => PRIVILEGED_RUNTIME_ROLES.has(String(entry?.role || '')))
  if (privileged) {
    throw new Error(`Production MongoDB application user has an over-privileged role: ${String(privileged.role)}. Use a dedicated least-privilege application role.`)
  }
}
