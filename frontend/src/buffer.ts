import type { Point } from "./types";
type Stored = Point & { key: string; owner: string; session: string };
type Meta = { key: string; seq: number };
let dbPromise: Promise<IDBDatabase> | undefined;
function database() {
  return (dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("smarttrack-gps", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      const points = db.createObjectStore("points", { keyPath: "key" });
      points.createIndex("session", ["owner", "session", "seq"], {
        unique: true,
      });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
const key = (owner: string, session: string) => `${owner}:${session}`;
export async function enqueue(
  owner: string,
  session: string,
  serverSeq: number,
  point: Omit<Point, "seq">,
): Promise<Point> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["meta", "points"], "readwrite");
    const req = tx.objectStore("meta").get(key(owner, session));
    let saved: Point;
    req.onsuccess = () => {
      const seq =
        Math.max(serverSeq, (req.result as Meta | undefined)?.seq || 0) + 1;
      saved = { ...point, seq };
      tx.objectStore("points").put({
        ...saved,
        key: `${key(owner, session)}:${seq}`,
        owner,
        session,
      });
      tx.objectStore("meta").put({ key: key(owner, session), seq });
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error || new Error("Local GPS storage failed"));
  });
}
export async function pending(
  owner: string,
  session: string,
  limit = 200,
): Promise<Point[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const req = db
      .transaction("points")
      .objectStore("points")
      .index("session")
      .getAll(
        IDBKeyRange.bound(
          [owner, session, 0],
          [owner, session, Number.MAX_SAFE_INTEGER],
        ),
        limit,
      );
    req.onsuccess = () =>
      resolve(
        (req.result as Stored[]).map(
          ({ key: _, owner: __, session: ___, ...p }) => p,
        ),
      );
    req.onerror = () => reject(req.error);
  });
}
export async function acknowledge(owner: string, session: string, seq: number) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("points", "readwrite");
    const req = tx
      .objectStore("points")
      .index("session")
      .openCursor(
        IDBKeyRange.bound([owner, session, 0], [owner, session, seq]),
      );
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
export async function countPending(owner: string, session: string) {
  const db = await database();
  return new Promise<number>((resolve, reject) => {
    const req = db
      .transaction("points")
      .objectStore("points")
      .index("session")
      .count(
        IDBKeyRange.bound(
          [owner, session, 0],
          [owner, session, Number.MAX_SAFE_INTEGER],
        ),
      );
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
