import { authenticatedFetch, type UserRole } from './auth'

export interface AdminUserRow {
  id: number
  username: string
  displayName: string
  email: string | null
  role: UserRole
  disabled: boolean
  // Đang bị chặn đăng nhập do nhập sai mật khẩu quá số lần cho phép (epoch ms, tự hết hạn) - null nếu không bị chặn.
  loginLockedUntil: number | null
  failedLoginCount: number
  createdAt: number
  managedByAdminId: number | null
  managedByUsername: string | null
  noteCount: number
  activeCount: number
  todoCount: number
  doneCount: number
  overdueCount: number
}

// Bản ghi note kiểu server trả về cho admin xem (giống shape đồng bộ ở
// db/api.ts) - admin chỉ XEM, không đồng bộ/sửa nên không cần đủ field local
// (serverId, synced...) như bảng notes trên IndexedDB của từng người dùng.
export interface AdminNote {
  serverId: string
  title: string
  content: string
  kind: 'note' | 'task'
  tag: string
  done: boolean
  deleted: 0 | 1
  createdAt: number | null
  startAt: number | null
  dueAt: number | null
  completedAt: number | null
  deletedAt: number | null
  updatedAt: number
}

export async function listUsers() {
  const body = await authenticatedFetch('/admin/users') as { users: AdminUserRow[] }
  return body.users
}

export async function getUserNotes(userId: number) {
  const body = await authenticatedFetch(`/admin/users/${userId}/notes`) as { notes: AdminNote[] }
  return body.notes
}

export async function createUserByAdmin(username: string, password: string, displayName: string, email: string) {
  await authenticatedFetch('/admin/users', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, displayName, email })
  })
}

export async function updateUserByAdmin(userId: number, displayName: string, email: string) {
  await authenticatedFetch(`/admin/users/${userId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName, email })
  })
}

export async function disableUser(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/disable`, { method: 'POST' })
}

export async function enableUser(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/enable`, { method: 'POST' })
}

// Mở chặn đăng nhập (do nhập sai mật khẩu nhiều lần) trước khi tự hết hạn.
export async function unlockLogin(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/unlock-login`, { method: 'POST' })
}

export async function adminResetPassword(userId: number, newPassword: string) {
  await authenticatedFetch(`/admin/users/${userId}/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ newPassword })
  })
}

// 4 hàm dưới chỉ root gọi được (backend tự chặn 403 nếu không phải root) -
// phân/hạ quyền admin, gán/bỏ gán user cho 1 admin thường quản lý.
export async function promoteUser(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/promote`, { method: 'POST' })
}

export async function demoteUser(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/demote`, { method: 'POST' })
}

export async function assignUser(userId: number, adminId: number) {
  await authenticatedFetch(`/admin/users/${userId}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminId })
  })
}

export async function unassignUser(userId: number) {
  await authenticatedFetch(`/admin/users/${userId}/unassign`, { method: 'POST' })
}

export interface AuditLogEntry {
  id: number
  actorId: number
  actorUsername: string
  targetId: number | null
  targetUsername: string | null
  action: string
  details: string | null
  createdAt: number
}

// Chỉ root gọi được (backend tự chặn 403 với admin thường).
export async function getAuditLog() {
  const body = await authenticatedFetch('/admin/audit-log') as { entries: AuditLogEntry[] }
  return body.entries
}
