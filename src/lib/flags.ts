const v = Number(import.meta.env.VITE_APP_VERSION ?? 1)
const envFlag = String(import.meta.env.VITE_FEATURE_CREATE_DAO ?? '').toLowerCase()

// version rule: v1 = no create, v2+ = allowed (can be overridden by env)
const versionAllowsCreate = v >= 2
const envAllowsCreate = envFlag === '' ? undefined : (envFlag === 'true')

// final flag (env overrides version if provided)
export const FLAGS = {
    version: v,
    canCreateDAO: envAllowsCreate ?? versionAllowsCreate,
}


// Admin AINs allowed to bypass create-DAO flag
const adminEnv = String(import.meta.env.VITE_UGOV_DAO_ADMIN_AIN ?? '').trim()

export const DAO_ADMINS: string[] = adminEnv
    ? adminEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : []

export function isDaoAdmin(ain?: string | null): boolean {
    if (!ain) return false
    return DAO_ADMINS.includes(ain)
}
