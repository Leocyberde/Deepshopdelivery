import type { Request } from 'express';

export const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'GERENTE', 'OPERADOR'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export type AdminPermission = 'dashboard'|'orders'|'customers'|'products'|'categories'|'inventory'|'kits'|'finance'|'notifications'|'audit'|'administrators'|'settings'|'backup';

export const ALL_PERMISSIONS: AdminPermission[] = ['dashboard','orders','customers','products','categories','inventory','kits','finance','notifications','audit','administrators','settings','backup'];
export const ROLE_PERMISSIONS: Record<string, AdminPermission[]> = {
  ADMIN: ALL_PERMISSIONS,
  SUPER_ADMIN: ALL_PERMISSIONS,
  GERENTE: ['dashboard','orders','customers','products','categories','inventory','kits','finance','notifications','audit','settings'],
  OPERADOR: ['dashboard','orders','customers','inventory','notifications'],
};
export function isAdminRole(role: string | null | undefined): boolean { return !!role && ADMIN_ROLES.includes(role as AdminRole); }
export function parsePermissions(role: string, raw: unknown): Set<string> {
  try {
    if (typeof raw === 'string' && raw.trim()) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {}
  return new Set(ROLE_PERMISSIONS[role] || []);
}
export function permissionForRequest(req: Request): AdminPermission | null {
  const p = req.path;
  if (/\/database\//.test(p) || /\/phase3\/backup/.test(p)) return 'backup';
  if (/\/phase3\/administrators/.test(p) || /\/credentials/.test(p)) return 'administrators';
  if (/\/settings|\/callmebot/.test(p)) return 'settings';
  if (/\/phase3\/audit/.test(p)) return 'audit';
  if (/\/finance|\/analytics/.test(p)) return 'finance';
  if (/\/notifications|broadcast/.test(p)) return 'notifications';
  if (/\/support/.test(p)) return 'orders';
  if (/\/orders|\/fulfillments|\/suppliers|\/refunds/.test(p)) return 'orders';
  if (/\/customers|\/addresses|\/freight/.test(p)) return 'customers';
  if (/\/inventory/.test(p)) return 'inventory';
  if (/\/kits/.test(p)) return 'kits';
  if (/\/categories/.test(p)) return 'categories';
  if (/\/products/.test(p) || /\/upload-image/.test(p)) return 'products';
  if (/\/dashboard/.test(p)) return 'dashboard';
  return 'dashboard';
}
export function isCriticalAdminOperation(req: Request): boolean {
  const p = req.path;
  return ((req.method !== 'GET' || /\/database\/export/.test(p)) && (/phase3\/administrators|\/settings|\/database\/restore|\/database\/export|\/credentials|\/products\/.*\/cost|\/orders\/.*\/status/.test(p)));
}
