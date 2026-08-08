// A minimal in-memory stand-in for the subset of the firebase-admin
// Firestore Admin API used by server endpoints in this repository.
//
// Supported:
//   collection(name).doc(id)
//   collection(name).where(f,"==",v)
//   collection/query .get()
//   docRef.get()/set()
//   db.runTransaction(fn)
//   db.batch().set(...).commit()
//   nested subcollections
//
// No real Firestore project/credentials are needed.
export function makeAdminFirestoreFake(initialDocs = {}, options = {}) {
  const store = new Map(Object.entries(initialDocs));
  const throwOnDocGet = options.throwOnDocGet instanceof Set ? options.throwOnDocGet : new Set(options.throwOnDocGet || []);
  const throwOnDocSet = options.throwOnDocSet instanceof Set ? options.throwOnDocSet : new Set(options.throwOnDocSet || []);

  function simulatedError(op, path) {
    return Object.assign(new Error(`adminFirestoreFake: simulated ${op} error on ${path}`), { code: "unavailable" });
  }

  function writeSet(path, data, opts) {
    if (throwOnDocSet.has(path)) throw simulatedError("set", path);
    if (opts?.merge) {
      const existing = store.get(path) || {};
      store.set(path, { ...existing, ...data });
    } else {
      store.set(path, { ...data });
    }
  }

  function docRef(path) {
    return {
      __kind: "docRef",
      path,
      collection(name) {
        return collectionRef(`${path}/${name}`);
      },
      async get() {
        if (throwOnDocGet.has(path)) throw simulatedError("get", path);
        const data = store.get(path);
        return { exists: data !== undefined, data: () => (data ? { ...data } : undefined), id: path.split("/").pop() };
      },
      async set(data, opts) {
        writeSet(path, data, opts);
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
      if (throwOnDocGet.has(ref.path)) throw simulatedError("get", ref.path);
      const data = store.get(ref.path);
      return { exists: data !== undefined, data: () => (data ? { ...data } : undefined), id: ref.path.split("/").pop() };
    },
    set(ref, data, opts) {
      writeSet(ref.path, data, opts);
    },
  };

  const db = {
    collection(name) {
      return collectionRef(name);
    },
    async runTransaction(fn) {
      return fn(transaction);
    },
    batch() {
      const operations = [];
      return {
        set(ref, data, opts) {
          operations.push({ ref, data, opts });
          return this;
        },
        async commit() {
          // Validate first so this fake preserves the all-or-nothing property
          // expected from a real Firestore WriteBatch for simulated failures.
          for (const operation of operations) {
            if (throwOnDocSet.has(operation.ref.path)) throw simulatedError("set", operation.ref.path);
          }
          for (const operation of operations) writeSet(operation.ref.path, operation.data, operation.opts);
          return [];
        },
      };
    },
  };

  return { db, store };
}
