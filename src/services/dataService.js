import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { starterCategories, starterProducts } from "./demoStore";
import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN, roundPoints } from "../utils/calculations";
import { cleanBookTitle, inferBookLanguage, normalizeBookTitle, readingBookId, readingSessionId } from "../utils/reading";
import { buildMaskCyclePatch } from "./maskCyclePatch";
import { buildReconcileJobId, createReconcileJob } from "./trackerReconcileJobs.js";
import { planSettlementDeletedEventRetractions } from "./completionEvents.js";
import { normalizeRevision, normalizeTrackersForStorage } from "../utils/trackerIdentity.js";
import { shouldEnqueueUnifiedTrackerJob } from "../utils/plannerFeatureFlags.js";
import { callRewardShop } from "./rewardShopApi.js";
import {
  POINT_TRANSACTIONS_COLLECTION,
  REWARD_INSTANCES_COLLECTION,
  buildTransactionEntry,
} from "../server/rewardShopCore.js";
import {
  earnPoints,
  spendPoints,
  applySettlementPoints,
  projectRewardPoints,
  rollbackSettlementPoints,
  rollbackRedemptionPoints,
} from "./pointsApi.js";

const profileDefaults = {
  // points is server-authoritative — NEVER written by the client.
  // Initial balance is set by backfillRewardShop migration or the first
  // server-side points operation. The Firestore real-time snapshot provides
  // the authoritative value for display (|| 0 fallback for new profiles).
  tomorrowGameMinutes: 0,
  todayBalanceMinutes: 0,
  nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
  nextDayEntertainmentLimitReason: "每日固定自由娱乐额度90min。",
  nextDayEntertainmentSourceDayType: "normal_progress_day",
  defaultTomorrowGameMinutes: 30,
  beneficialProtectionMinutes: 60,
  miscTags: [],
  entertainmentTags: [],
  travelDayBonusPoints: 1,
  eventBookLink: "",
  scheduleAssistantSettings: {},
  scheduleAssistantDraft: {},
  scheduleAssistantDraftArchive: [],
  scheduleSegmentGoals: {},
  dashboardTargetProductIds: [],
  dashboardGoalTitle: "",
  dashboardGoalMessage: "",
  dashboardGoalDate: "",
  // Legacy inline base64 data URL. Retained purely as the read-path fallback
  // for profiles that have not re-uploaded yet — new saves write the bytes to
  // users/{uid}/assets/dashboardGoalImage and leave this empty.
  dashboardGoalImage: "",
  // Lightweight pointer at that asset document (path/contentType/byteSize/
  // version). Null until the user uploads under the new scheme.
  dashboardGoalImageRef: null,
  lastMaskDate: "",
  maskCycle: {},
  healthMaintenanceItems: [],
  trackers: [],
  trackerMigrationState: { status: "never_run", ranges: [] },
  periodCycle: { status: "inactive", startedOn: "", endedOn: "" },
};

function userDoc(uid) {
  return doc(db, "users", uid);
}

function userCollection(uid, name) {
  return collection(db, "users", uid, name);
}

/**
 * Appends one row to the point ledger (users/{uid}/pointTransactions) using
 * the SAME shape rewardShopCore builds for redemptions, so 雪尘's
 * get_reward_transactions sees earning and spending in one consistent
 * stream. Always called with the caller's existing batch/transaction so the
 * ledger row and the balance change land together or not at all.
 *
 * `writer` is a Firestore WriteBatch or Transaction — both expose .set().
 */
function writePointLedgerEntry(writer, uid, entry) {
  writer.set(doc(userCollection(uid, POINT_TRANSACTIONS_COLLECTION)), {
    ...buildTransactionEntry(entry),
    createdAt: serverTimestamp(),
  });
}

export async function ensureUserSeed(uid, user) {
  const profileRef = userDoc(uid);
  const snapshot = await getDoc(profileRef);

  if (!snapshot.exists()) {
    const batch = writeBatch(db);
    batch.set(profileRef, {
      ...profileDefaults,
      displayName: user?.displayName || "Claire",
      email: user?.email || "",
      photoURL: user?.photoURL || "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    starterCategories.forEach((category) => {
      batch.set(doc(db, "users", uid, "categories", category.id), {
        ...category,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    starterProducts.forEach((product) => {
      batch.set(doc(db, "users", uid, "products", product.id), {
        ...product,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    });

    await batch.commit();
    return;
  }

  await setDoc(
    profileRef,
    {
      displayName: user?.displayName || snapshot.data()?.displayName || "Claire",
      email: user?.email || "",
      photoURL: user?.photoURL || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await ensureStarterStoreItems(uid);
}

async function ensureStarterStoreItems(uid) {
  const batch = writeBatch(db);
  let hasMissingItems = false;

  for (const category of starterCategories) {
    const ref = doc(db, "users", uid, "categories", category.id);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      batch.set(ref, {
        ...category,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      hasMissingItems = true;
    }
  }

  for (const product of starterProducts) {
    const ref = doc(db, "users", uid, "products", product.id);
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      batch.set(ref, {
        ...product,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      hasMissingItems = true;
    }
  }

  if (hasMissingItems) await batch.commit();
}

export function subscribeUserData(uid, callback) {
  const unsubscribers = [];
  const state = {
    profile: profileDefaults,
    categories: [],
    products: [],
    settlements: [],
    dailyReviewDrafts: [],
    redemptions: [],
    pointTransactions: [],
    rewardInstances: [],
    mathProgress: [],
    professionalProgress: [],
    developmentPlans: [],
    entertainmentLogs: [],
    entertainmentExtensions: [],
    projectRewardApplications: [],
    diaryEntries: [],
    books: [],
    readingSessions: [],
  };

  const emit = () => callback({ ...state });

  unsubscribers.push(
    onSnapshot(userDoc(uid), (snapshot) => {
      state.profile = { ...profileDefaults, id: snapshot.id, ...snapshot.data(), points: roundPoints(snapshot.data()?.points) };
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "categories"), orderBy("name", "asc")), (snapshot) => {
      state.categories = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "products"), orderBy("price", "asc")), (snapshot) => {
      state.products = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "settlements"), orderBy("createdAt", "desc")), (snapshot) => {
      state.settlements = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(userCollection(uid, "dailyReviewDrafts"), (snapshot) => {
      state.dailyReviewDrafts = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "redemptions"), orderBy("createdAt", "desc")), (snapshot) => {
      state.redemptions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  // The point ledger and the owned-reward shelf. Both are append-mostly and
  // small, and both are written by the browser AND by the signed Cyberboss
  // endpoint — subscribing means a redemption 雪尘 made in WeChat shows up on
  // an open page without a refresh.
  unsubscribers.push(
    onSnapshot(query(userCollection(uid, POINT_TRANSACTIONS_COLLECTION), orderBy("createdAt", "desc")), (snapshot) => {
      state.pointTransactions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, REWARD_INSTANCES_COLLECTION), orderBy("redeemedAt", "desc")), (snapshot) => {
      state.rewardInstances = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "mathProgress"), orderBy("updatedAt", "desc")), (snapshot) => {
      state.mathProgress = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "professionalProgress"), orderBy("updatedAt", "desc")), (snapshot) => {
      state.professionalProgress = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "developmentPlans"), orderBy("updatedAt", "desc")), (snapshot) => {
      state.developmentPlans = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "entertainmentLogs"), orderBy("createdAt", "desc")), (snapshot) => {
      state.entertainmentLogs = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "entertainmentExtensions"), orderBy("createdAt", "desc")), (snapshot) => {
      state.entertainmentExtensions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "projectRewardApplications"), orderBy("createdAt", "desc")), (snapshot) => {
      state.projectRewardApplications = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "diaryEntries"), orderBy("date", "desc")), (snapshot) => {
      state.diaryEntries = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "books"), orderBy("updatedAt", "desc")), (snapshot) => {
      state.books = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  unsubscribers.push(
    onSnapshot(query(userCollection(uid, "readingSessions"), orderBy("date", "desc")), (snapshot) => {
      state.readingSessions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
      emit();
    })
  );

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

export async function saveCategory(uid, category) {
  const payload = {
    name: category.name || "",
    icon: category.icon || "✨",
    color: category.color || "#8B5CF6",
    description: category.description || "",
    updatedAt: serverTimestamp(),
  };

  if (category.id) {
    await updateDoc(doc(db, "users", uid, "categories", category.id), payload);
  } else {
    await addDoc(userCollection(uid, "categories"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }
}

export async function deleteCategory(uid, categoryId) {
  await deleteDoc(doc(db, "users", uid, "categories", categoryId));
}

/**
 * The Mall product editor also writes through /api/reward-shop now.
 *
 * `products` is not just a catalogue — `price` is the number the redemption
 * transaction charges. Leaving the browser able to edit it directly would
 * leave the whole server-side balance guarantee bypassable by setting a
 * price to 0 first, so the editor goes through the same allow-listed engine
 * and the same validation 雪尘 gets.
 *
 * `legacyStatus` carries the Mall's own shelf state (available / wishlist /
 * paused / redeemed), kept distinct from the engine's active/inactive listing
 * state so the two never overwrite each other.
 */
export async function saveProduct(uid, product) {
  const payload = {
    name: product.name || "",
    category: product.categoryId || "",
    price: Number(product.price) || 0,
    description: product.description || "",
    icon: product.icon || "",
    imageUrl: product.imageUrl || "",
    rarity: product.rarity || "common",
    priority: product.priority || "medium",
    sortOrder: Number(product.sortOrder || 0),
    legacyStatus: product.status || "available",
    limitedUntil: product.limitedUntil || "",
    repeatable: product.repeatable !== false,
    note: product.note || "",
  };

  if (product.id) return await callRewardShop("update_shop_item", { itemId: product.id, ...payload });
  return await callRewardShop("create_shop_item", payload);
}

export async function deleteProduct(uid, productId) {
  return await callRewardShop("delete_shop_item", { itemId: productId });
}

export async function saveDiaryEntry(uid, entry) {
  const date = entry.date || "";
  if (!date) throw new Error("日记需要日期。");
  const ref = doc(db, "users", uid, "diaryEntries", date);
  const snapshot = await getDoc(ref);
  const payload = {
    date,
    title: entry.title || "",
    summary: entry.summary || "",
    content: entry.content || "",
    rawTags: Array.isArray(entry.rawTags) ? entry.rawTags : [],
    normalizedTags: Array.isArray(entry.normalizedTags) ? entry.normalizedTags : [],
    tagGroups: entry.tagGroups || {},
    people: Array.isArray(entry.people) ? entry.people : [],
    places: Array.isArray(entry.places) ? entry.places : [],
    moodScore: entry.moodScore ?? null,
    energyScore: entry.energyScore ?? null,
    sleepImpact: entry.sleepImpact || "",
    phoneInterference: entry.phoneInterference || "",
    dayType: entry.dayType || "",
    studyMinutes: Number(entry.studyMinutes || 0),
    favorite: entry.favorite === true,
    isPrivate: entry.isPrivate !== false,
    source: entry.source || "manual",
    sourceReviewDate: entry.sourceReviewDate || "",
    lastSyncedFromSettlementAt: entry.lastSyncedFromSettlementAt || "",
    manuallyEdited: entry.manuallyEdited === true,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, snapshot.exists() ? payload : { ...payload, createdAt: serverTimestamp() }, { merge: true });
}

export async function syncDiaryFromSettlement(uid, entry, strategy = "overwrite") {
  const date = entry.date || entry.sourceReviewDate || "";
  if (!date) throw new Error("日记同步需要日期。");
  const ref = doc(db, "users", uid, "diaryEntries", date);
  const snapshot = await getDoc(ref);
  const existing = snapshot.exists() ? snapshot.data() : null;
  const now = new Date().toISOString();
  const tags = Array.isArray(entry.normalizedTags) ? entry.normalizedTags : [];
  const existingTags = Array.isArray(existing?.normalizedTags) ? existing.normalizedTags : [];
  const mergedTags = Array.from(new Set([...existingTags, ...tags]));

  if (existing && (existing.manuallyEdited || existing.source === "manual") && strategy === "cancel") {
    throw new Error("今天的日记已经手动编辑过，本次未覆盖。");
  }

  const base = {
    date,
    rawTags: strategy === "tags" ? mergedTags : Array.isArray(entry.rawTags) ? entry.rawTags : tags,
    normalizedTags: strategy === "tags" ? mergedTags : tags,
    tagGroups: strategy === "tags" ? existing?.tagGroups || entry.tagGroups || {} : entry.tagGroups || {},
    source: "daily-settlement",
    sourceReviewDate: entry.sourceReviewDate || date,
    lastSyncedFromSettlementAt: now,
    updatedAt: serverTimestamp(),
  };

  const payload = strategy === "tags"
    ? base
    : {
        ...base,
        title: entry.title || existing?.title || "",
        summary: entry.summary || existing?.summary || "",
        content: entry.content || existing?.content || "",
        people: Array.isArray(entry.people) ? entry.people : existing?.people || [],
        places: Array.isArray(entry.places) ? entry.places : existing?.places || [],
        moodScore: entry.moodScore ?? existing?.moodScore ?? null,
        energyScore: entry.energyScore ?? existing?.energyScore ?? null,
        sleepImpact: entry.sleepImpact || existing?.sleepImpact || "",
        phoneInterference: entry.phoneInterference || existing?.phoneInterference || "",
        dayType: entry.dayType || existing?.dayType || "",
        studyMinutes: Number(entry.studyMinutes ?? existing?.studyMinutes ?? 0),
        favorite: entry.favorite === true || existing?.favorite === true,
        isPrivate: entry.isPrivate !== false,
        manuallyEdited: false,
      };

  await setDoc(ref, existing ? payload : { ...payload, createdAt: serverTimestamp() }, { merge: true });
}

export async function syncReadingFromSettlement(uid, reading) {
  const date = reading.date || reading.sourceReviewDate || "";
  const title = cleanBookTitle(reading.bookTitle || reading.readingBookTitle || "");
  const minutes = Number(reading.minutes ?? reading.readingMinutes ?? 0);
  if (!date || !title || minutes <= 0) return { skipped: true };

  const normalizedTitle = normalizeBookTitle(title);
  const bookId = reading.bookId || readingBookId(title);
  const sessionId = readingSessionId(date, title);
  const bookRef = doc(db, "users", uid, "books", bookId);
  const sessionRef = doc(db, "users", uid, "readingSessions", sessionId);
  const [bookSnapshot, sessionSnapshot] = await Promise.all([getDoc(bookRef), getDoc(sessionRef)]);
  const existingBook = bookSnapshot.exists() ? bookSnapshot.data() : null;
  const existingSession = sessionSnapshot.exists() ? sessionSnapshot.data() : null;
  const previousMinutes = Number(existingSession?.minutes || 0);
  const minutesDiff = minutes - previousMinutes;
  const isNewSession = !existingSession;

  const sessionPayload = {
    date,
    source: reading.source || "daily-review",
    sourceReviewDate: reading.sourceReviewDate || date,
    bookId,
    bookTitle: existingBook?.title || title,
    normalizedBookTitle: normalizedTitle,
    minutes,
    feeling: reading.feeling || reading.readingFeeling || "",
    note: reading.note || "",
    tags: Array.isArray(reading.tags) ? reading.tags : [],
    updatedAt: serverTimestamp(),
  };

  const bookPayload = existingBook
    ? {
        title: existingBook.title || title,
        normalizedTitle,
        status: existingBook.status || "reading",
        language: existingBook.language || inferBookLanguage(title),
        totalMinutes: Math.max(0, Number(existingBook.totalMinutes || 0) + minutesDiff),
        sessionCount: Math.max(0, Number(existingBook.sessionCount || 0) + (isNewSession ? 1 : 0)),
        firstReadDate: existingBook.firstReadDate && existingBook.firstReadDate < date ? existingBook.firstReadDate : date,
        lastReadDate: existingBook.lastReadDate && existingBook.lastReadDate > date ? existingBook.lastReadDate : date,
        recentFeeling: reading.feeling || reading.readingFeeling || existingBook.recentFeeling || "",
        updatedAt: serverTimestamp(),
      }
    : {
        title,
        normalizedTitle,
        author: "",
        originalTitle: "",
        status: "reading",
        category: "",
        tags: [],
        language: inferBookLanguage(title),
        type: "other",
        totalMinutes: minutes,
        sessionCount: 1,
        firstReadDate: date,
        lastReadDate: date,
        finishedDate: "",
        progressText: "",
        rating: 0,
        favorite: false,
        notesCount: 0,
        quotesCount: 0,
        recentFeeling: reading.feeling || reading.readingFeeling || "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

  const batch = writeBatch(db);
  batch.set(bookRef, bookPayload, { merge: true });
  batch.set(sessionRef, sessionSnapshot.exists() ? sessionPayload : { ...sessionPayload, createdAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  return { skipped: false, bookId, sessionId };
}

export async function saveBookEntry(uid, book) {
  const title = cleanBookTitle(book.title || "");
  if (!title) throw new Error("书籍需要标题。");
  const id = book.id || readingBookId(title);
  await setDoc(doc(db, "users", uid, "books", id), {
    title,
    normalizedTitle: normalizeBookTitle(title),
    author: book.author || "",
    originalTitle: book.originalTitle || "",
    status: book.status || "reading",
    category: book.category || "",
    tags: Array.isArray(book.tags) ? book.tags : [],
    language: book.language || inferBookLanguage(title),
    type: book.type || "other",
    progressText: book.progressText || "",
    rating: Number(book.rating || 0),
    favorite: book.favorite === true,
    finishedDate: book.finishedDate || "",
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function saveDevelopmentPlan(uid, plan) {
  const payload = {
    title: plan.title || "",
    kind: plan.kind || "feature",
    type: plan.type || "feature",
    estimatedMinutes: Math.max(1, Number(plan.estimatedMinutes || legacyDevelopmentMinutes(plan))),
    priority: plan.priority || "medium",
    status: plan.status || "idea",
    note: plan.note || "",
    updatedAt: serverTimestamp(),
  };

  if (plan.id) {
    await updateDoc(doc(db, "users", uid, "developmentPlans", plan.id), payload);
  } else {
    await addDoc(userCollection(uid, "developmentPlans"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }
}

export async function deleteDevelopmentPlan(uid, planId) {
  await deleteDoc(doc(db, "users", uid, "developmentPlans", planId));
}

export async function completeDevelopmentPlan(uid, plan, profilePoints) {
  const batch = writeBatch(db);
  batch.update(userDoc(uid), {
    updatedAt: serverTimestamp(),
  });

  const payload = {
    title: plan.title || "",
    kind: plan.kind || "feature",
    type: plan.type || "feature",
    estimatedMinutes: Math.max(1, Number(plan.estimatedMinutes || legacyDevelopmentMinutes(plan))),
    priority: plan.priority || "medium",
    note: plan.note || "",
    status: "done",
    pointsSpent: 0,
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (plan.id) {
    batch.update(doc(db, "users", uid, "developmentPlans", plan.id), payload);
  } else {
    batch.set(doc(userCollection(uid, "developmentPlans")), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

function developmentPlanCost(plan) {
  if (plan?.kind === "bug") return 1;
  return Math.max(1, Math.ceil(legacyDevelopmentMinutes(plan) / 15));
}

function legacyDevelopmentMinutes(plan) {
  const minutes = Number(plan?.estimatedMinutes || 0);
  if (minutes > 0) return minutes;
  return { micro: 15, small: 30 }[plan?.size] || 15;
}

export async function saveProfileSettings(uid, settings) {
  const payload = {
    updatedAt: serverTimestamp(),
  };

  if ("displayName" in settings) payload.displayName = settings.displayName || "Claire";
  if ("points" in settings) payload.points = roundPoints(settings.points);
  if ("defaultTomorrowGameMinutes" in settings) payload.defaultTomorrowGameMinutes = Number(settings.defaultTomorrowGameMinutes) || 0;
  if ("beneficialProtectionMinutes" in settings) payload.beneficialProtectionMinutes = Number(settings.beneficialProtectionMinutes) || 60;
  if ("miscTags" in settings) payload.miscTags = Array.isArray(settings.miscTags) ? settings.miscTags : [];
  if ("entertainmentTags" in settings) payload.entertainmentTags = Array.isArray(settings.entertainmentTags) ? settings.entertainmentTags : [];
  if ("travelDayBonusPoints" in settings) payload.travelDayBonusPoints = Number(settings.travelDayBonusPoints || 1);
  if ("eventBookLink" in settings) payload.eventBookLink = settings.eventBookLink || "";
  if ("scheduleAssistantSettings" in settings) payload.scheduleAssistantSettings = settings.scheduleAssistantSettings || {};
  if ("snowdustDeskVerification" in settings) payload.snowdustDeskVerification = settings.snowdustDeskVerification || {};
  if ("scheduleAssistantDraft" in settings) payload.scheduleAssistantDraft = settings.scheduleAssistantDraft || {};
  if ("scheduleAssistantDraftArchive" in settings) payload.scheduleAssistantDraftArchive = Array.isArray(settings.scheduleAssistantDraftArchive) ? settings.scheduleAssistantDraftArchive : [];
  if ("scheduleSegmentGoals" in settings) payload.scheduleSegmentGoals = settings.scheduleSegmentGoals || {};
  if ("plannerCategoryOrder" in settings) payload.plannerCategoryOrder = Array.isArray(settings.plannerCategoryOrder) ? settings.plannerCategoryOrder : [];
  if ("healthMaintenanceItems" in settings) payload.healthMaintenanceItems = Array.isArray(settings.healthMaintenanceItems) ? settings.healthMaintenanceItems : [];
  if ("maintenanceItemOrder" in settings) payload.maintenanceItemOrder = Array.isArray(settings.maintenanceItemOrder) ? settings.maintenanceItemOrder : [];
  if ("classificationTaxonomy" in settings) payload.classificationTaxonomy = Array.isArray(settings.classificationTaxonomy) ? settings.classificationTaxonomy : [];
  if ("reviewTrackers" in settings) payload.reviewTrackers = Array.isArray(settings.reviewTrackers) ? settings.reviewTrackers : [];
  if ("reviewTrackerOrder" in settings) payload.reviewTrackerOrder = Array.isArray(settings.reviewTrackerOrder) ? settings.reviewTrackerOrder : [];
  // Unified tracker fact layer's Tracker config array (id/title/schedule/
  // goal/evidenceBindings/stickerSettings) — trackerReconcileFirestore.js
  // already reads profile.trackers, but until now nothing could actually
  // persist it (no TrackerManager UI yet either).
  if ("trackers" in settings) payload.trackers = normalizeTrackersForStorage(settings.trackers);
  if ("trackerMigrationState" in settings) payload.trackerMigrationState = settings.trackerMigrationState || { status: "never_run", ranges: [] };
  if ("reviewProjects" in settings) payload.reviewProjects = Array.isArray(settings.reviewProjects) ? settings.reviewProjects : [];
  if ("scheduleStickerTemplates" in settings) payload.scheduleStickerTemplates = Array.isArray(settings.scheduleStickerTemplates) ? settings.scheduleStickerTemplates : [];
  if ("periodCycle" in settings) payload.periodCycle = settings.periodCycle || { status: "inactive", startedOn: "", endedOn: "" };
  if ("entertainmentQuickPresets" in settings) payload.entertainmentQuickPresets = Array.isArray(settings.entertainmentQuickPresets) ? settings.entertainmentQuickPresets : [];
  if ("dashboardTargetProductIds" in settings) payload.dashboardTargetProductIds = Array.isArray(settings.dashboardTargetProductIds) ? settings.dashboardTargetProductIds : [];
  if ("dashboardTargetUpdatedAt" in settings) payload.dashboardTargetUpdatedAt = settings.dashboardTargetUpdatedAt || "";
  if ("dashboardGoalTitle" in settings) payload.dashboardGoalTitle = settings.dashboardGoalTitle || "";
  if ("dashboardGoalMessage" in settings) payload.dashboardGoalMessage = settings.dashboardGoalMessage || "";
  if ("dashboardGoalDate" in settings) payload.dashboardGoalDate = settings.dashboardGoalDate || "";
  if ("dashboardGoalImage" in settings) payload.dashboardGoalImage = settings.dashboardGoalImage || "";
  // Pointer at users/{uid}/assets/dashboardGoalImage. Explicit null (not
  // omitted) when cleared, so "清空图片" actually detaches the asset instead of
  // leaving a stale pointer behind under merge:true.
  if ("dashboardGoalImageRef" in settings) payload.dashboardGoalImageRef = settings.dashboardGoalImageRef || null;
  // Value-gated for the same reason as focusSyncSettings below: `settings` is
  // usually a spread of the settings form, so a merely-present key with a
  // null/undefined value would land here as `{}` and wipe the user's whole
  // daily-review UI config (pinnedCategoryIds decides which entries the review
  // form even shows). Callers that genuinely want to clear it pass a real `{}`.
  if (settings.dailyReviewUi && typeof settings.dailyReviewUi === "object") payload.dailyReviewUi = settings.dailyReviewUi;
  // Deliberately gated on the VALUE being a real object, not just the key
  // being present — `settings` is normally built by spreading the settings
  // form, which always HAS this key even for a user who never touched the
  // Focus mapping UI (value null/undefined in that case). Writing `{}` in
  // that case would wrongly tell Cyberboss "the user explicitly cleared
  // their remote config", permanently overriding its local JSON fallback
  // for someone who never opened this feature.
  if (settings.focusSyncSettings && typeof settings.focusSyncSettings === "object") payload.focusSyncSettings = settings.focusSyncSettings;

  await setDoc(
    userDoc(uid),
    payload,
    { merge: true }
  );
}

export async function completeScheduleSegmentGoal(uid, goalEntry, rewardPoints = 1, profilePoints = 0) {
  return await earnPoints({
    amount: Number(rewardPoints || 1),
    source: "schedule_segment_goal",
    description: `完成时段目标 ${goalEntry?.date || ""}`.trim(),
    relatedEntityId: goalEntry.date || null,
    idempotencyKey: `schedule:${uid}:${goalEntry.date || Date.now()}`,
    _goalEntry: goalEntry, // forwarded to server for scheduleSegmentGoals write
  });
}

export async function saveMathProgressRecord(uid, record) {
  const payload = {
    itemId: record.itemId,
    trackId: record.trackId,
    trackName: record.trackName,
    sectionId: record.sectionId,
    sectionTitle: record.sectionTitle,
    code: record.code,
    title: record.title,
    completed: record.completed === true,
    completedDate: record.completedDate || "",
    courseCompleted: record.courseCompleted === true,
    courseDate: record.courseDate || "",
    exerciseCompleted: record.exerciseCompleted === true,
    exerciseDate: record.exerciseDate || "",
    source: record.source || "manual",
    note: record.note || "",
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "users", uid, "mathProgress", record.itemId), payload, { merge: true });
}

export async function saveProfessionalProgressRecord(uid, record) {
  const payload = {
    itemId: record.itemId,
    stageId: record.stageId,
    stageTitle: record.stageTitle,
    sectionId: record.sectionId,
    sectionTitle: record.sectionTitle,
    moduleTitle: record.moduleTitle,
    lectureTitle: record.lectureTitle,
    number: record.number,
    label: record.label,
    mode: record.mode,
    title: record.title,
    page: record.page || "",
    completed: record.completed === true,
    completedDate: record.completedDate || "",
    note: record.note || "",
    updatedAt: serverTimestamp(),
  };

  await setDoc(doc(db, "users", uid, "professionalProgress", record.itemId), payload, { merge: true });
}

/**
 * Redeeming from the Mall page goes through /api/reward-shop, which verifies
 * this user's Firebase ID token and then runs the SAME engine the WeChat path
 * uses (src/server/rewardShopEngine.js) under the Admin SDK, inside a real
 * Firestore transaction:
 *   idempotency -> listing/stock/balance check -> points -> stock ->
 *   pointTransactions row -> rewardInstances doc -> legacy 兑换记录.
 *
 * The browser no longer performs this write itself. That is the point: the
 * balance can only move on the server, so a tampered page, a stale tab or a
 * hand-crafted Firestore call cannot mint points.
 *
 * `profilePoints` is kept in the signature for the existing callers but is
 * only a pre-flight courtesy check — the authoritative balance is re-read
 * inside the server transaction, so a stale page can no longer overdraw.
 *
 * The default idempotency key buckets clicks into 5-second windows, which is
 * what makes an impatient double-click produce ONE redemption instead of two.
 */
export async function redeemProduct(uid, product, profilePoints, { idempotencyKey = "" } = {}) {
  const price = Number(product.price) || 0;
  if (Number(profilePoints || 0) < price) {
    throw new Error(`还差 ${roundPoints(price - Number(profilePoints || 0))} 分。小椰先帮你把它放在愿望单前排。`);
  }

  const key = idempotencyKey || `web:${uid}:${product.id}:${Math.floor(Date.now() / 5000)}`;
  return await callRewardShop("redeem_shop_item", { itemId: product.id, idempotencyKey: key });
}

/**
 * Marks one already-redeemed reward as used. Never touches points — the
 * points were spent at redemption time, using the reward is free.
 */
export async function useRewardInstance(uid, { rewardInstanceId = "", itemId = "", query: itemQuery = "", idempotencyKey = "" } = {}) {
  const key = idempotencyKey || `web-use:${uid}:${rewardInstanceId || itemId || itemQuery}:${Math.floor(Date.now() / 5000)}`;
  return await callRewardShop("use_reward", { rewardInstanceId, itemId, query: itemQuery, idempotencyKey: key });
}

export async function saveEntertainmentLog(uid, log) {
  const payload = {
    date: log.date || "",
    type: log.type || "other",
    minutes: Math.max(0, Number(log.minutes || 0)),
    note: log.note || "",
    createdAt: serverTimestamp(),
  };
  await addDoc(userCollection(uid, "entertainmentLogs"), payload);
}

export async function redeemEntertainmentExtension(uid, extension, profilePoints) {
  const pointsSpent = Number(extension.pointsSpent || 0);
  if (Number(profilePoints || 0) < pointsSpent) {
    throw new Error(`还差 ${pointsSpent - Number(profilePoints || 0)} 分，先把加时放一放。`);
  }
  return await spendPoints({
    amount: pointsSpent,
    source: "entertainment_extension",
    description: `娱乐加时 +${Number(extension.minutes || 0)}min`,
    idempotencyKey: `entertain:${uid}:${extension.date || Date.now()}`,
    _extension: {
      date: extension.date || "",
      minutes: Number(extension.minutes || 0),
      pointsSpent,
      reason: extension.reason || "",
      thesisOutput: extension.thesisOutput || "",
      checks: extension.checks || {},
    },
  });
}

export function buildSettlementProfilePatch(settlement, profilePoints = 0, pointDelta = Number(settlement.pointsAdded || 0), previousMaskCycle = {}) {
  const profilePatch = {
    points: roundPoints(Number(profilePoints || 0) + Number(pointDelta || 0)),
    todayBalanceMinutes: Number(settlement.generatedMinutes),
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "",
    updatedAt: serverTimestamp(),
  };
  const maskCycle = buildMaskCyclePatch(settlement, previousMaskCycle);
  if (maskCycle) profilePatch.maskCycle = maskCycle;
  if (settlement.health?.maskStatus === "已敷" && settlement.reviewDate) {
    profilePatch.lastMaskDate = settlement.reviewDate;
  }
  return profilePatch;
}

// The new review workbench has one ownership boundary: profile points, the
// dated settlement and its draft move together.  The older create/revise
// helpers below remain for their legacy callers.
export async function saveReviewWorkbenchSettlement(uid, settlement, draft, { enableUnifiedTracker = false } = {}) {
  const settlementId = settlement.existingSettlementId || settlement.reviewDate;
  if (!settlement.reviewDate || !settlementId) throw new Error("缺少复盘日期，无法保存结算。");

  const result = await applySettlementPoints({
    settlement,
    draft,
    idempotencyKey: `settlement:${uid}:${settlement.reviewDate}:${settlement.settlementRevision || 0}`,
  });

  // Tracker reconcile job — best-effort after the atomic settlement write.
  // If this write fails, the tracker can reconcile from the settlement doc itself.
  const revision = result.settlementRevision ?? 0;
  const enqueueJob = shouldEnqueueUnifiedTrackerJob(enableUnifiedTracker);
  if (enqueueJob) {
    const jobId = buildReconcileJobId(settlementId, revision);
    try {
      await setDoc(doc(db, "users", uid, "trackerReconcileJobs", jobId),
        createReconcileJob({ id: settlementId, settlementRevision: revision, reviewDate: settlement.reviewDate }),
        { merge: true });
    } catch { /* best-effort */ }
  }

  return { id: settlementId, settlementRevision: revision, pointDelta: result.delta, reconcileJobId: enqueueJob ? buildReconcileJobId(settlementId, revision) : null };
}

export async function createSettlement(uid, settlement, profilePoints = 0) {
  return await applySettlementPoints({
    action: "create_settlement",
    settlement,
    idempotencyKey: `create-settlement:${uid}:${settlement.reviewDate || Date.now()}`,
  });
}

// A revision updates the existing settlement and the point delta in the same
// Firestore batch.  It must never be implemented as delete-and-create: the
// historical order and downstream diary links are tied to the document id.
export async function reviseSettlement(uid, settlement, previousSettlement, profilePoints = 0, { enableUnifiedTracker = false } = {}) {
  if (!previousSettlement?.id) throw new Error("缺少需要修订的结算记录。");

  const result = await applySettlementPoints({
    action: "revise_settlement",
    settlement,
    previousSettlement,
    idempotencyKey: `revise-settlement:${uid}:${previousSettlement.id}:${Date.now()}`,
  });

  const settlementRevision = Number(previousSettlement.settlementRevision || 0) + 1;
  // Tracker reconcile job — best-effort after the atomic write
  if (shouldEnqueueUnifiedTrackerJob(enableUnifiedTracker)) {
    try {
      const reconcileJob = createReconcileJob({
        id: previousSettlement.id,
        settlementRevision,
        reviewDate: settlement.reviewDate || previousSettlement.reviewDate,
      });
      await setDoc(doc(db, "users", uid, "trackerReconcileJobs", buildReconcileJobId(previousSettlement.id, settlementRevision)), reconcileJob, { merge: true });
    } catch { /* best-effort */ }
  }

  return result;
}

async function fetchCompletionEventsForSettlement(uid, settlementId) {
  const snapshot = await getDocs(query(
    collection(db, "users", uid, "completionEvents"),
    where("sourceDocumentId", "==", settlementId),
  ));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

async function planDeletedSettlementEventRetractions(uid, settlements) {
  const uniqueSettlements = [...new Map((Array.isArray(settlements) ? settlements : [])
    .filter((settlement) => settlement?.id)
    .map((settlement) => [settlement.id, settlement])).values()];
  const eventLists = await Promise.all(uniqueSettlements.map((settlement) => fetchCompletionEventsForSettlement(uid, settlement.id)));
  const recordedAt = new Date().toISOString();
  return eventLists.flatMap((events) => planSettlementDeletedEventRetractions(events, { recordedAt }));
}

export async function saveProjectRewardApplication(uid, application, profilePoints = 0) {
  const finalPoints = roundPoints(application.finalPoints);
  const existingFinalPoints = roundPoints(application.existingFinalPoints);
  return await projectRewardPoints({
    finalPoints,
    existingFinalPoints,
    description: `结项奖励：${application.eventName || "未命名事件"}`,
    relatedEntityId: application.id || null,
    idempotencyKey: `project-reward:${uid}:${application.id || Date.now()}`,
    eventName: application.eventName || "",
    eventBookLink: application.eventBookLink || "",
    archived: application.archived === true,
    result: application.result || "",
    requestedPoints: Number(application.requestedPoints || 0),
    note: application.note || "",
    applicationId: application.id || null,
  });
}

export async function deleteLatestSettlement(uid, settlement, fallbackProfile, profilePoints = 0) {
  const eventRetractions = await planDeletedSettlementEventRetractions(uid, [settlement]);
  return await rollbackSettlementPoints({
    pointsToRemove: Number(settlement.pointsAdded || 0),
    description: `删除结算${settlement.reviewDate || settlement.id || ""}`,
    idempotencyKey: `delete-settlement:${uid}:${settlement.id || Date.now()}`,
    settlementIds: [settlement.id],
    eventRetractions,
    fallbackProfile,
  });
}

export async function rollbackSettlementsTo(uid, settlementsToDelete, targetSettlement, profilePoints = 0) {
  const eventRetractions = await planDeletedSettlementEventRetractions(uid, settlementsToDelete);
  const pointsToRemove = settlementsToDelete.reduce((sum, item) => sum + Number(item.pointsAdded || 0), 0);
  return await rollbackSettlementPoints({
    pointsToRemove,
    description: `批量回滚${settlementsToDelete.length}条结算`,
    idempotencyKey: `rollback-settlements:${uid}:${Date.now()}`,
    settlementIds: settlementsToDelete.map((s) => s.id),
    eventRetractions,
    fallbackProfile: {
      todayBalanceMinutes: Number(targetSettlement.generatedMinutes || 0),
      nextDayEntertainmentLimitReason: targetSettlement.nextDayEntertainmentLimitReason || "",
      nextDayEntertainmentSourceDayType: targetSettlement.nextDayEntertainmentSourceDayType || "normal_progress_day",
    },
  });
}

export async function deleteLatestRedemption(uid, redemption, product, profilePoints = 0) {
  return await rollbackRedemptionPoints({
    priceToRefund: Number(redemption.price || 0),
    description: `撤回兑换：${redemption.productName || ""}`,
    idempotencyKey: `delete-redemption:${uid}:${redemption.id || Date.now()}`,
    redemptionId: redemption.id || null,
    extensionId: redemption.type === "entertainment_extension" ? redemption.extensionId : null,
    productId: product?.status === "redeemed" ? product.id : null,
  });
}
