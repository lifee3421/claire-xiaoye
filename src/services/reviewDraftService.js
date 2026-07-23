import { doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "./firebase";

const draftRef = (uid, date) => doc(db, "users", uid, "dailyReviewDrafts", date);
export function subscribeReviewDrafts(uid, callback) {
  return onSnapshot(doc(db, "users", uid), () => {});
}
export function subscribeReviewDraft(uid, date, callback) {
  return onSnapshot(draftRef(uid, date), (snapshot) => callback(snapshot.exists() ? { date: snapshot.id, ...snapshot.data() } : null));
}
export async function saveReviewDraft(uid, draft) {
  await setDoc(draftRef(uid, draft.date), { ...draft, schemaVersion: 2, timezone: "Asia/Shanghai", updatedAt: serverTimestamp() }, { merge: true });
}
