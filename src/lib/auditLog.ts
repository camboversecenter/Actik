import { supabase } from './supabase'

export interface AuditLogEntry {
  id?: string
  action: string
  admin_id?: string
  institution_id?: string
  institution_name?: string
  timestamp: string
  ip_address: string
  user_agent: string
  reason?: string
  details?: object
  signature?: string
  status_before?: string
  status_after?: string
  created_at?: string
}

function getClientIp(): string {
  // Try multiple sources for IP address
  // Headers: x-forwarded-for, x-real-ip
  // Fallback: unknown
  // Note: Browser can't easily get IP, this is placeholder
  // In production, server-side will get real IP
  return 'unknown'
}

export async function logApproval(
  institutionId: string,
  institutionName: string
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const currentAdminId = session?.user?.id

    const entry: AuditLogEntry = {
      action: 'APPROVE_INSTITUTION',
      admin_id: currentAdminId,
      institution_id: institutionId,
      institution_name: institutionName,
      timestamp: new Date().toISOString(),
      ip_address: getClientIp(),
      user_agent: navigator.userAgent,
      status_before: 'PENDING',
      status_after: 'ACCREDITED'
    }

    const { error } = await supabase.from('audit_logs').insert([entry])
    if (error) throw error
  } catch (error) {
    console.error('Failed to log approval action:', error)
  }
}

export async function logRevocation(
  institutionId: string,
  institutionName: string,
  reason: string
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const currentAdminId = session?.user?.id

    const entry: AuditLogEntry = {
      action: 'REVOKE_ACCREDITATION',
      admin_id: currentAdminId,
      institution_id: institutionId,
      institution_name: institutionName,
      timestamp: new Date().toISOString(),
      ip_address: getClientIp(),
      user_agent: navigator.userAgent,
      reason: reason,
      status_before: 'ACCREDITED',
      status_after: 'REVOKED'
    }

    const { error } = await supabase.from('audit_logs').insert([entry])
    if (error) throw error
  } catch (error) {
    console.error('Failed to log revocation action:', error)
  }
}

export async function logRejection(
  institutionId: string,
  institutionName: string,
  reason: string
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const currentAdminId = session?.user?.id

    const entry: AuditLogEntry = {
      action: 'REJECT_APPLICATION',
      admin_id: currentAdminId,
      institution_id: institutionId,
      institution_name: institutionName,
      timestamp: new Date().toISOString(),
      ip_address: getClientIp(),
      user_agent: navigator.userAgent,
      reason: reason,
      status_before: 'PENDING',
      status_after: 'REJECTED'
    }

    const { error } = await supabase.from('audit_logs').insert([entry])
    if (error) throw error
  } catch (error) {
    console.error('Failed to log rejection action:', error)
  }
}

export async function logInstitutionRestore(
  institutionId: string,
  institutionName: string
): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const currentAdminId = session?.user?.id

    const entry: AuditLogEntry = {
      action: 'RESTORE_ACCREDITATION',
      admin_id: currentAdminId,
      institution_id: institutionId,
      institution_name: institutionName,
      timestamp: new Date().toISOString(),
      ip_address: getClientIp(),
      user_agent: navigator.userAgent,
      status_before: 'REVOKED',
      status_after: 'ACCREDITED'
    }

    const { error } = await supabase.from('audit_logs').insert([entry])
    if (error) throw error
  } catch (error) {
    console.error('Failed to log restore action:', error)
  }
}
