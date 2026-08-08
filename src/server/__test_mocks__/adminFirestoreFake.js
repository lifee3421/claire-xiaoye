// A minimal in-memory stand-in for the exact subset of the firebase-admin
// Firestore Admin API api/planner-proposal.js, api/planner-apply.js, and
// api/exercise-record-sync.js use:
//   collection(name).doc(id)           — ref builder
//   collection(name).where(f,"==",v)   — query builder
//   db.runTransaction(fn)              — transactional reads + writes
//   docRef.get()                       — non-transactional doc read
//   docRef.set(data, options)          — non-transactional doc write
//   collection(name).doc(id).collection(name2).doc(id2)  — nested subcollection
//
// No real Firestore project/credentials needed — this lets the endpoints'
// actual transaction logic (not just "does the module load") be exercised
// directly under `node --test`.
//
// `set(ref, data, {merge:true})` matches real Firestore top-level merge
// semantics: `{...existing, ...data}` — a nested object VALUE is replaced
// wholesale, not deep-merged, exactly like the real service (this project's
// endpoints only ever write whole nested objects as one field's value, never
// rely on deep-merge, so this is faithful for our purposes).
//
// options.throwOnDocGet / throwOnDocSet: Set<string> of store paths that
// throw a simulated Firestore error when read or written — lets tests
// exercise error-handling / fallback paths without a real network.
export function makeAdminFirestoreFake(initialDocs = {}, options = {}) {
  const store = new Map(Object.entries(initialDocs));
  const throwOnDocGet = options.throwOnDocGet instanceof Set ? options.throwOnDocGet : new Set(options.throwOnDocGet || []);
  const throwOnDocSet = options.throwOnDocSet instanceof Set ? options.throwOnDocSet : new Set(options.throwOnDocSet || []);

  function simulatedError(op, path) {
    return Object.assign(new Error(`adminFirestoreFake: simulated ${op} error on ${path}`), { code: "unavailable" });
  }

  function docRef(path) {
    return {
      __kind: "docRef",
      path,
      collection(name) {
        return collectionRef(`${path}/${name}`);
      },
      // Non-transactional single-doc read (mirrors admin SDK's docRef.get()).
      async get() {
        if (throwOnDocGet.has(path)) throw simulatedError("get", path);
        const data = store.get(path);
        return { exists: data !== undefined, data: () => (data ? { ...data } : undefined), id: path.split("/").pop() };
      },
      // Non-transactional single-doc write (mirrors admin SDK's docRef.set()).
      async set(data, opts) {
        if (throwOnDocSet.has(path)) throw simulatedError("set", path);
        if (opts?.merge) {
          const existing = store.get(path) || {};
          store.set(path, { ...existing, ...data });
        } else {
          store.set(path, { ...data });
        }
      },
    };
  }
  function collectionRef(path) {
    return {
      __kind: "collectionRef",
      path,
      doc(id) {
        return docRef(`${path}/${id}`);
      },
      where(field, op, value) {
        return queryRef(path, [{ field, op, value }]);
      },
      // Standalone (non-transactional) read — used for prefetches that don't
      // need transactional consistency (e.g. planner-apply's books/
      // readingSessions read). Same resolution as transaction.get(query).
      async get() {
        return resolveQuery({ path, filters: [] });
      },
    };
  }
  function queryRef(path, filters) {
    return {
      __kind: "query",
      path,
      filters,
      where(field, op, value) {
        return queryRef(path, [...filters, { field, op, value }]);
      },
      async get() {
        return resolveQuery({ path, filters });
      },
    };
  }

  function applyOp(fieldValue, op, value) {
    if (op === "==") return fieldValue === value;
    throw new Error(`adminFirestoreFake: unsupported operator "${op}"`);
  }

  function isDirectChild(candidatePath, collectionPath) {
    if (!candidatePath.startsWith(`${collectionPath}/`)) return false;
    return candidatePath.slice(collectionPath.length + 1).split("/").length === 1;
  }

  function resolveQuery(ref) {
    const docs = [...store.entries()]
      .filter(([key]) => isDirectChild(key, ref.path))
      .filter(([, data]) => ref.filters.every((filter) => applyOp(data[filter.field], filter.op, filter.value)))
      .map(([key, data]) => ({ id: key.split("/").pop(), exists: true, data: () => ({ ...data }) }));
    return { docs };
  }

  const transaction = {
    async get(ref) {
      if (ref.__kind === "query" || ref.__kind === "collectionRef") {
        return resolveQuery({ path: ref.path, filters: ref.filters || [] });
      }
      const data = store.get(ref.path);
      return { exists: data !== undefined, data: () => (data ? { ...data } : undefined), id: ref.path.split("/").pop() };
    },
    set(ref, data, options) {
      if (options?.merge) {
        const existing = store.get(ref.path) || {};
        store.set(ref.path, { ...existing, ...data });
      } else {
        store.set(ref.path, { ...data });
      }
    },
  };

  const db = {
    collection(name) {
      return collectionRef(name);
    },
    async runTransaction(fn) {
      return fn(transaction);
    },
  };

  return { db, store };
}
