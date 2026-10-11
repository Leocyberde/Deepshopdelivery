import path from 'path';

// Pasta de backups: fora da pasta pública e, por padrão, fora do projeto.
export const BACKUP_DIR = process.env.BACKUP_DIR
  ? path.resolve(process.env.BACKUP_DIR)
  : path.resolve(process.cwd(), '..', 'achadinhos-backups');
export const SNAPSHOT_DIR = path.join(BACKUP_DIR, 'snapshots');
export const DAILY_DIR = path.join(BACKUP_DIR, 'daily');
