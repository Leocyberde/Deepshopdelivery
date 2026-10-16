import test from 'node:test';
import assert from 'node:assert/strict';
import { registerFulfillmentRoutes } from '../../src/server/routes/fulfillmentRoutes.ts';

test('rotas de fornecedores e compras são registradas com CRUD e filtros', () => {
  const paths: string[] = [];
  const app = new Proxy({}, {
    get: (_target, method: string) => (...args: unknown[]) => {
      const path = args[0];
      if (typeof path === 'string') paths.push(`${method} ${path}`);
      else if (Array.isArray(path)) for (const item of path) paths.push(`${method} ${String(item)}`);
      return app;
    },
  }) as any;
  registerFulfillmentRoutes(app);
  assert.ok(paths.includes('post /api/admin/suppliers'));
  assert.ok(paths.includes('patch /api/admin/suppliers/:id'));
  assert.ok(paths.includes('delete /api/admin/suppliers/:id'));
  assert.ok(paths.includes('get /api/admin/purchases'));
  assert.ok(paths.includes('post /api/admin/purchases'));
  assert.ok(paths.includes('patch /api/admin/purchases/:id'));
  assert.ok(paths.includes('delete /api/admin/purchases/:id'));
});
