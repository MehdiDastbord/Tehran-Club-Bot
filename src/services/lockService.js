const locks = new Map();
const rwLocks = new Map();

function withKeyLock(key, task) {
  const prev = locks.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(task);
  locks.set(key, next);
  return next.finally(() => {
    if (locks.get(key) === next) locks.delete(key);
  });
}

function getRwState(key) {
  let state = rwLocks.get(key);
  if (!state) {
    state = { readers: 0, writer: false, writersWaiting: 0, queue: [] };
    rwLocks.set(key, state);
  }
  return state;
}

function drain(state) {
  if (state.writer || state.readers > 0) return;
  const first = state.queue[0];
  if (!first) return;

  if (first.mode === 'write') {
    state.queue.shift();
    state.writer = true;
    state.writersWaiting = Math.max(0, state.writersWaiting - 1);
    first.resolve();
    return;
  }

  while (state.queue.length && state.queue[0].mode === 'read' && state.writersWaiting === 0) {
    const waiter = state.queue.shift();
    state.readers += 1;
    waiter.resolve();
  }
}

function acquireRead(state) {
  if (!state.writer && state.writersWaiting === 0) {
    state.readers += 1;
    return Promise.resolve();
  }
  return new Promise(resolve => state.queue.push({ mode: 'read', resolve }));
}

function acquireWrite(state) {
  state.writersWaiting += 1;
  if (!state.writer && state.readers === 0 && state.queue.length === 0) {
    state.writersWaiting -= 1;
    state.writer = true;
    return Promise.resolve();
  }
  return new Promise(resolve => state.queue.push({ mode: 'write', resolve }));
}

function releaseRead(key, state) {
  state.readers = Math.max(0, state.readers - 1);
  drain(state);
  if (!state.writer && state.readers === 0 && state.queue.length === 0) rwLocks.delete(key);
}

function releaseWrite(key, state) {
  state.writer = false;
  drain(state);
  if (!state.writer && state.readers === 0 && state.queue.length === 0) rwLocks.delete(key);
}

async function withReadLock(key, task) {
  const state = getRwState(key);
  await acquireRead(state);
  try {
    return await task();
  } finally {
    releaseRead(key, state);
  }
}

async function withWriteLock(key, task) {
  const state = getRwState(key);
  await acquireWrite(state);
  try {
    return await task();
  } finally {
    releaseWrite(key, state);
  }
}

module.exports = { withKeyLock, withReadLock, withWriteLock };
