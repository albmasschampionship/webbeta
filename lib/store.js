import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'registrations.json');

// All writes go through this promise chain so two simultaneous checkouts can
// never clobber each other.
let queue = Promise.resolve();

async function readAll() {
  try {
    const raw = await readFile(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    if (err instanceof SyntaxError) return [];
    throw err;
  }
}

async function writeAll(records) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(records, null, 2), 'utf8');
  await rename(tmp, FILE);
}

function mutate(fn) {
  const next = queue.then(async () => {
    const records = await readAll();
    const result = await fn(records);
    await writeAll(records);
    return result;
  });
  queue = next.catch(() => {});
  return next;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function token(length) {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export function newReference() {
  return `AMC27-${token(6)}`;
}

export function newCheckInCode() {
  return `${token(4)}-${token(4)}`;
}

export async function list() {
  const records = await readAll();
  return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function create(record) {
  return mutate((records) => {
    records.push(record);
    return record;
  });
}

export function update(ref, patch) {
  return mutate((records) => {
    const index = records.findIndex((r) => r.ref === ref);
    if (index === -1) return null;
    records[index] = { ...records[index], ...patch, updatedAt: new Date().toISOString() };
    return records[index];
  });
}

export async function findByRef(ref) {
  const records = await readAll();
  return records.find((r) => r.ref === ref) || null;
}

export async function findBySession(sessionId) {
  const records = await readAll();
  return records.find((r) => r.stripeSessionId === sessionId) || null;
}
