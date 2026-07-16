import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { db } from "./firebase";
import { starterCategories, starterProducts } from "./demoStore";
import { DAILY_FREE_ENTERTAINMENT_LIMIT_MIN, roundPoints } from "../utils/calculations";
import { cleanBookTitle, inferBookLanguage, normalizeBookTitle, readingBookId, readingSessionId } from "../utils/reading";

const profileDefaults = {
  points: 0,
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
  dashboardGoalImage: "",
  lastMaskDate: "",
  maskCycle: {},
  healthMaintenanceItems: [],
  periodCycle: { status: "inactive", startedOn: "", endedOn: "" },
};

function userDoc(uid) {
  return doc(db, "users", uid);
}

function userCollection(uid, name) {
  return collection(db, "users", uid, name);
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
    redemptions: [],
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
    onSnapshot(query(userCollection(uid, "redemptions"), orderBy("createdAt", "desc")), (snapshot) => {
      state.redemptions = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
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

export async function saveProduct(uid, product) {
  const payload = {
    name: product.name || "",
    categoryId: product.categoryId || "",
    price: Number(product.price) || 0,
    description: product.description || "",
    icon: product.icon || "",
    imageUrl: product.imageUrl || "",
    rarity: product.rarity || "common",
    priority: product.priority || "medium",
    sortOrder: Number(product.sortOrder || 0),
    status: product.status || "available",
    limitedUntil: product.limitedUntil || "",
    repeatable: product.repeatable !== false,
    note: product.note || "",
    updatedAt: serverTimestamp(),
  };

  if (product.id) {
    await updateDoc(doc(db, "users", uid, "products", product.id), payload);
  } else {
    await addDoc(userCollection(uid, "products"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }
}

export async function deleteProduct(uid, productId) {
  await deleteDoc(doc(db, "users", uid, "products", productId));
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
  if ("scheduleAssistantDraft" in settings) payload.scheduleAssistantDraft = settings.scheduleAssistantDraft || {};
  if ("scheduleAssistantDraftArchive" in settings) payload.scheduleAssistantDraftArchive = Array.isArray(settings.scheduleAssistantDraftArchive) ? settings.scheduleAssistantDraftArchive : [];
  if ("scheduleSegmentGoals" in settings) payload.scheduleSegmentGoals = settings.scheduleSegmentGoals || {};
  if ("healthMaintenanceItems" in settings) payload.healthMaintenanceItems = Array.isArray(settings.healthMaintenanceItems) ? settings.healthMaintenanceItems : [];
  if ("periodCycle" in settings) payload.periodCycle = settings.periodCycle || { status: "inactive", startedOn: "", endedOn: "" };
  if ("entertainmentQuickPresets" in settings) payload.entertainmentQuickPresets = Array.isArray(settings.entertainmentQuickPresets) ? settings.entertainmentQuickPresets : [];
  if ("dashboardTargetProductIds" in settings) payload.dashboardTargetProductIds = Array.isArray(settings.dashboardTargetProductIds) ? settings.dashboardTargetProductIds : [];
  if ("dashboardTargetUpdatedAt" in settings) payload.dashboardTargetUpdatedAt = settings.dashboardTargetUpdatedAt || "";
  if ("dashboardGoalTitle" in settings) payload.dashboardGoalTitle = settings.dashboardGoalTitle || "";
  if ("dashboardGoalMessage" in settings) payload.dashboardGoalMessage = settings.dashboardGoalMessage || "";
  if ("dashboardGoalDate" in settings) payload.dashboardGoalDate = settings.dashboardGoalDate || "";
  if ("dashboardGoalImage" in settings) payload.dashboardGoalImage = settings.dashboardGoalImage || "";

  await setDoc(
    userDoc(uid),
    payload,
    { merge: true }
  );
}

export async function completeScheduleSegmentGoal(uid, goalEntry, rewardPoints = 1, profilePoints = 0) {
  const pointsToAdd = Number(rewardPoints || 1);
  const batch = writeBatch(db);
  batch.set(userDoc(uid), {
    points: roundPoints(Number(profilePoints || 0) + pointsToAdd),
    scheduleSegmentGoals: {
      [goalEntry.date]: goalEntry,
    },
    updatedAt: serverTimestamp(),
  }, { merge: true });
  await batch.commit();
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

export async function redeemProduct(uid, product, profilePoints) {
  const price = Number(product.price) || 0;
  if (profilePoints < price) {
    throw new Error(`还差 ${price - profilePoints} 分。小椰先帮你把它放在愿望单前排。`);
  }

  const batch = writeBatch(db);
  const remainingPoints = roundPoints(profilePoints - price);

  batch.update(userDoc(uid), {
    points: remainingPoints,
    updatedAt: serverTimestamp(),
  });

  if (product.repeatable === false) {
    batch.update(doc(db, "users", uid, "products", product.id), {
      status: "redeemed",
      updatedAt: serverTimestamp(),
    });
  }

  batch.set(doc(userCollection(uid, "redemptions")), {
    productId: product.id,
    productName: product.name,
    categoryId: product.categoryId,
    price,
    remainingPoints,
    note: product.note || "",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
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

  const batch = writeBatch(db);
  const extensionRef = doc(userCollection(uid, "entertainmentExtensions"));
  const remainingPoints = roundPoints(Number(profilePoints || 0) - pointsSpent);
  batch.update(userDoc(uid), {
    points: remainingPoints,
    updatedAt: serverTimestamp(),
  });
  batch.set(extensionRef, {
    date: extension.date || "",
    minutes: Number(extension.minutes || 0),
    pointsSpent,
    reason: extension.reason || "",
    thesisOutput: extension.thesisOutput || "",
    checks: extension.checks || {},
    createdAt: serverTimestamp(),
  });
  batch.set(doc(userCollection(uid, "redemptions")), {
    type: "entertainment_extension",
    extensionId: extensionRef.id,
    productName: `当日娱乐加时 +${Number(extension.minutes || 0)}min`,
    categoryId: "entertainment_extension",
    price: pointsSpent,
    remainingPoints,
    minutes: Number(extension.minutes || 0),
    date: extension.date || "",
    note: extension.reason || "",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function createSettlement(uid, settlement, profilePoints = 0) {
  const batch = writeBatch(db);
  const profilePatch = {
    points: roundPoints(Number(profilePoints || 0) + Number(settlement.pointsAdded || 0)),
    todayBalanceMinutes: Number(settlement.generatedMinutes),
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "",
    updatedAt: serverTimestamp(),
    maskCycle: {
      lastMaskDateAfterReview: settlement.lastMaskDateAfterReview || settlement.lastMaskDateBeforeReview || "",
      shouldScheduleMaskTomorrow: settlement.shouldScheduleMaskTomorrow === true,
      tomorrowDate: settlement.maskTomorrowDate || "",
      status: settlement.maskCycleStatus || "",
      message: settlement.maskCycleMessage || "",
      nextSuggestedDate: settlement.nextMaskSuggestedDate || "",
      updatedFromReviewDate: settlement.reviewDate || "",
    },
  };
  if (settlement.health?.maskStatus === "已敷" && settlement.reviewDate) {
    profilePatch.lastMaskDate = settlement.reviewDate;
  }
  batch.update(userDoc(uid), profilePatch);

  batch.set(doc(userCollection(uid, "settlements")), {
    ...settlement,
    studyMinutes: Number(settlement.studyMinutes),
    studyCredit: Number(settlement.studyCredit),
    exerciseMinutes: Number(settlement.exerciseMinutes),
    exerciseCredit: Number(settlement.exerciseCredit),
    exerciseIntensityText: settlement.exerciseIntensityText || "",
    sleepAdjustment: Number(settlement.sleepAdjustment),
    allocatedGameMinutesForToday: Number(settlement.allocatedGameMinutesForToday || 0),
    actualGameMinutesToday: Number(settlement.actualGameMinutesToday || 0),
    gameOverrun: Number(settlement.gameOverrun || 0),
    gameOverrunAdjustment: Number(settlement.gameOverrunAdjustment || settlement.gameOverrun || 0),
    beneficialMinutes: Number(settlement.beneficialMinutes || 0),
    totalEntertainmentMinutes: Number(settlement.totalEntertainmentMinutes || 0),
    webEntertainmentMinutes: Number(settlement.webEntertainmentMinutes || 0),
    recognizedEntertainmentMinutes: Number(settlement.recognizedEntertainmentMinutes || 0),
    entertainmentOverLimitMinutes: Number(settlement.entertainmentOverLimitMinutes || 0),
    entertainmentPenaltyPoints: Number(settlement.entertainmentPenaltyPoints || 0),
    entertainmentPenaltyLabel: settlement.entertainmentPenaltyLabel || "",
    entertainmentScoreDelta: Number(settlement.entertainmentScoreDelta || 0),
    entertainmentScoreLabel: settlement.entertainmentScoreLabel || "",
    freeEntertainmentLimitMinutes: Number(settlement.freeEntertainmentLimitMinutes || DAILY_FREE_ENTERTAINMENT_LIMIT_MIN),
    readingMinutes: Number(settlement.readingMinutes || settlement.subjects?.reading?.minutes || 0),
    readingBookTitle: settlement.readingBookTitle || settlement.subjects?.reading?.bookTitle || "",
    readingFeeling: settlement.readingFeeling || settlement.subjects?.reading?.feeling || "",
    readingSessions: Array.isArray(settlement.readingSessions) ? settlement.readingSessions : settlement.subjects?.reading?.sessions || [],
    health: settlement.health || {},
    lastMaskDateBeforeReview: settlement.lastMaskDateBeforeReview || "",
    lastMaskDateAfterReview: settlement.lastMaskDateAfterReview || "",
    shouldScheduleMaskTomorrow: settlement.shouldScheduleMaskTomorrow === true,
    maskTomorrowDate: settlement.maskTomorrowDate || "",
    maskCycleStatus: settlement.maskCycleStatus || "",
    maskCycleMessage: settlement.maskCycleMessage || "",
    nextMaskSuggestedDate: settlement.nextMaskSuggestedDate || "",
    entertainmentFenceMatchesReview: settlement.entertainmentFenceMatchesReview !== false,
    entertainmentFenceNote: settlement.entertainmentFenceNote || "",
    beneficialAdjustment: Number(settlement.beneficialAdjustment || 0),
    entertainmentAdjustment: Number(settlement.entertainmentAdjustment || 0),
    generatedMinutes: Number(settlement.generatedMinutes),
    availableMinutes: Number(settlement.availableMinutes),
    tomorrowGameMinutes: 0,
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "",
    dayTypeDisplayName: settlement.dayTypeDisplayName || "",
    mainlineStamps: settlement.mainlineStamps || {},
    bankPointsAdded: Number(settlement.bankPointsAdded || 0),
    sleepAdjustmentPoints: Number(settlement.sleepAdjustmentPoints ?? settlement.sleepAdjustment ?? 0),
    exerciseBonusPoints: Number(settlement.exerciseBonusPoints || 0),
    workMinutes: Number(settlement.workMinutes || 0),
    workPoints: Number(settlement.workPoints || 0),
    dayTypeBonusPoints: Number(settlement.dayTypeBonusPoints || 0),
    isTravelDay: settlement.isTravelDay === true,
    travelDayBonusPoints: Number(settlement.travelDayBonusPoints || 0),
    reviewTimelinessBonus: Number(settlement.reviewTimelinessBonus || 0),
    pointsAdded: roundPoints(settlement.pointsAdded),
    reviewDate: settlement.reviewDate || "",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function saveProjectRewardApplication(uid, application, profilePoints = 0) {
  const finalPoints = roundPoints(application.finalPoints);
  const existingFinalPoints = roundPoints(application.existingFinalPoints);
  const pointDelta = roundPoints(finalPoints - existingFinalPoints);
  const payload = {
    eventName: application.eventName || "",
    eventBookLink: application.eventBookLink || "",
    archived: application.archived === true,
    result: application.result || "",
    requestedPoints: Number(application.requestedPoints || 0),
    finalPoints,
    note: application.note || "",
    status: finalPoints > 0 ? "approved" : "draft",
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  if (application.id) {
    batch.set(doc(db, "users", uid, "projectRewardApplications", application.id), payload, { merge: true });
  } else {
    batch.set(doc(userCollection(uid, "projectRewardApplications")), {
      ...payload,
      createdAt: serverTimestamp(),
    });
  }
  if (pointDelta) {
    batch.update(userDoc(uid), {
      points: roundPoints(Number(profilePoints || 0) + pointDelta),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(userCollection(uid, "redemptions")), {
      type: "project_reward",
      productName: `结项奖励：${payload.eventName || "未命名事件"}`,
      categoryId: "project_reward",
      price: -pointDelta,
      pointsAdded: pointDelta,
      remainingPoints: roundPoints(Number(profilePoints || 0) + pointDelta),
      note: payload.note || "",
      createdAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function deleteLatestSettlement(uid, settlement, fallbackProfile, profilePoints = 0) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "settlements", settlement.id));
  batch.update(userDoc(uid), {
    points: roundPoints(Number(profilePoints || 0) - Number(settlement.pointsAdded || 0)),
    todayBalanceMinutes: Number(fallbackProfile.todayBalanceMinutes || 0),
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    nextDayEntertainmentLimitReason: fallbackProfile.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: fallbackProfile.nextDayEntertainmentSourceDayType || "normal_progress_day",
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function rollbackSettlementsTo(uid, settlementsToDelete, targetSettlement, profilePoints = 0) {
  const batch = writeBatch(db);
  const pointsToRemove = settlementsToDelete.reduce((sum, item) => sum + Number(item.pointsAdded || 0), 0);

  settlementsToDelete.forEach((settlement) => {
    batch.delete(doc(db, "users", uid, "settlements", settlement.id));
  });

  batch.update(userDoc(uid), {
    points: roundPoints(Number(profilePoints || 0) - pointsToRemove),
    todayBalanceMinutes: Number(targetSettlement.generatedMinutes || 0),
    nextDayBaseEntertainmentLimit: DAILY_FREE_ENTERTAINMENT_LIMIT_MIN,
    nextDayEntertainmentLimitReason: targetSettlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: targetSettlement.nextDayEntertainmentSourceDayType || "normal_progress_day",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function deleteLatestRedemption(uid, redemption, product, profilePoints = 0) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "redemptions", redemption.id));
  batch.update(userDoc(uid), {
    points: roundPoints(Number(profilePoints || 0) + Number(redemption.price || 0)),
    updatedAt: serverTimestamp(),
  });

  if (redemption.type === "entertainment_extension" && redemption.extensionId) {
    batch.delete(doc(db, "users", uid, "entertainmentExtensions", redemption.extensionId));
  }

  if (product?.status === "redeemed") {
    batch.update(doc(db, "users", uid, "products", product.id), {
      status: "wishlist",
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();
}
