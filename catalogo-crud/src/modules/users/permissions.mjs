export const SUPER_ADMIN_ROLE = 'superadministrador';
export const ROLES = Object.freeze([SUPER_ADMIN_ROLE, 'administrador', 'cliente']);

export function isAdminRole(role) {
  return role === 'administrador' || role === SUPER_ADMIN_ROLE;
}

export function accessExpired(user, now = Date.now()) {
  return user.access_expires_at != null && Date.parse(user.access_expires_at) <= now;
}
