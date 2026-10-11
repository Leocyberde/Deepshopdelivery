// Utilitário para Visitor ID anônimo persistente
let memoryVisitorId: string | null = null;

export function getOrCreateVisitorId(): string {
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('achadinhos_visitor_id_v1') : null;
    if (stored && stored.length > 10) {
      return stored;
    }
    const randomPart = Math.random().toString(36).substring(2, 12);
    const timePart = Date.now().toString(36);
    const newId = `vis_${randomPart}_${timePart}`;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('achadinhos_visitor_id_v1', newId);
    }
    return newId;
  } catch (_e) {
    if (!memoryVisitorId) {
      memoryVisitorId = `vis_mem_${Math.random().toString(36).substring(2, 12)}_${Date.now().toString(36)}`;
    }
    return memoryVisitorId;
  }
}
