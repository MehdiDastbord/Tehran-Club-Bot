const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { sqlitePath, backupDir } = require('../src/config');

const sourceArg = process.argv[2];
if (!sourceArg) {
  console.error('Usage: npm run restore -- ./backups/tehran-club-YYYY-MM-DD.sqlite');
  process.exit(2);
}

const source = path.resolve(sourceArg);
const target = path.resolve(sqlitePath);
if (!fs.existsSync(source)) throw new Error(`BACKUP_NOT_FOUND: ${source}`);

const verify = new Database(source, { readonly: true });
try {
  const result = String(verify.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
  if (result !== 'ok') throw new Error(`BACKUP_INTEGRITY_FAILED: ${result}`);
} finally {
  verify.close();
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.mkdirSync(backupDir, { recursive: true });
const safety = path.join(backupDir, `pre-restore-${stamp}.sqlite`);
if (fs.existsSync(target)) fs.copyFileSync(target, safety);

const temp = `${target}.restore-${process.pid}-${Date.now()}`;
fs.copyFileSync(source, temp);
const check = new Database(temp, { readonly: true });
try {
  const result = String(check.prepare('PRAGMA integrity_check').get()?.integrity_check || 'unknown');
  if (result !== 'ok') throw new Error(`RESTORED_COPY_INTEGRITY_FAILED: ${result}`);
} finally { check.close(); }

fs.renameSync(temp, target);
console.log(`Restore complete: ${source}`);
console.log(`Safety backup: ${fs.existsSync(safety) ? safety : 'none'}`);
