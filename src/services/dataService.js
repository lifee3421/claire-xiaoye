import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
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

const profileDefaults = {
  points: 0,
  tomorrowGameMinutes: 0,
  todayBalanceMinutes: 0,
  nextDayBaseEntertainmentLimit: 60,
  nextDayEntertainmentLimitReason: "默认普通日基础娱乐上限60min。",
  nextDayEntertainmentSourceDayType: "normal_progress_day",
  defaultTomorrowGameMinutes: 30,
  beneficialProtectionMinutes: 60,
  miscTags: [],
  scheduleAssistantSettings: {},
  scheduleAssistantDraft: {},
  scheduleSegmentGoals: {},
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
  };

  const emit = () => callback({ ...state });

  unsubscribers.push(
    onSnapshot(userDoc(uid), (snapshot) => {
      state.profile = { ...profileDefaults, id: snapshot.id, ...snapshot.data() };
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
  if ("points" in settings) payload.points = Number(settings.points) || 0;
  if ("defaultTomorrowGameMinutes" in settings) payload.defaultTomorrowGameMinutes = Number(settings.defaultTomorrowGameMinutes) || 0;
  if ("beneficialProtectionMinutes" in settings) payload.beneficialProtectionMinutes = Number(settings.beneficialProtectionMinutes) || 60;
  if ("miscTags" in settings) payload.miscTags = Array.isArray(settings.miscTags) ? settings.miscTags : [];
  if ("scheduleAssistantSettings" in settings) payload.scheduleAssistantSettings = settings.scheduleAssistantSettings || {};
  if ("scheduleAssistantDraft" in settings) payload.scheduleAssistantDraft = settings.scheduleAssistantDraft || {};
  if ("scheduleSegmentGoals" in settings) payload.scheduleSegmentGoals = settings.scheduleSegmentGoals || {};

  await setDoc(
    userDoc(uid),
    payload,
    { merge: true }
  );
}

export async function completeScheduleSegmentGoal(uid, goalEntry) {
  const batch = writeBatch(db);
  batch.set(userDoc(uid), {
    points: increment(1),
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
  const remainingPoints = profilePoints - price;

  batch.update(userDoc(uid), {
    points: increment(-price),
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
  batch.update(userDoc(uid), {
    points: increment(-pointsSpent),
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
    remainingPoints: Number(profilePoints || 0) - pointsSpent,
    minutes: Number(extension.minutes || 0),
    date: extension.date || "",
    note: extension.reason || "",
    createdAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function createSettlement(uid, settlement) {
  const batch = writeBatch(db);
  batch.update(userDoc(uid), {
    points: increment(Number(settlement.pointsAdded)),
    todayBalanceMinutes: Number(settlement.generatedMinutes),
    nextDayBaseEntertainmentLimit: Number(settlement.nextDayBaseEntertainmentLimit || 60),
    nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "",
    updatedAt: serverTimestamp(),
  });

  batch.set(doc(userCollection(uid, "settlements")), {
    ...settlement,
    studyMinutes: Number(settlement.studyMinutes),
    studyCredit: Number(settlement.studyCredit),
    exerciseMinutes: Number(settlement.exerciseMinutes),
    exerciseCredit: Number(settlement.exerciseCredit),
    sleepAdjustment: Number(settlement.sleepAdjustment),
    allocatedGameMinutesForToday: Number(settlement.allocatedGameMinutesForToday || 0),
    actualGameMinutesToday: Number(settlement.actualGameMinutesToday || 0),
    gameOverrun: Number(settlement.gameOverrun || 0),
    gameOverrunAdjustment: Number(settlement.gameOverrunAdjustment || settlement.gameOverrun || 0),
    beneficialMinutes: Number(settlement.beneficialMinutes || 0),
    totalEntertainmentMinutes: Number(settlement.totalEntertainmentMinutes || 0),
    webEntertainmentMinutes: Number(settlement.webEntertainmentMinutes || 0),
    recognizedEntertainmentMinutes: Number(settlement.recognizedEntertainmentMinutes || 0),
    entertainmentFenceMatchesReview: settlement.entertainmentFenceMatchesReview !== false,
    entertainmentFenceNote: settlement.entertainmentFenceNote || "",
    beneficialAdjustment: Number(settlement.beneficialAdjustment || 0),
    entertainmentAdjustment: Number(settlement.entertainmentAdjustment || 0),
    generatedMinutes: Number(settlement.generatedMinutes),
    availableMinutes: Number(settlement.availableMinutes),
    tomorrowGameMinutes: 0,
    nextDayBaseEntertainmentLimit: Number(settlement.nextDayBaseEntertainmentLimit || 60),
    nextDayEntertainmentLimitReason: settlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: settlement.nextDayEntertainmentSourceDayType || "",
    dayTypeDisplayName: settlement.dayTypeDisplayName || "",
    mainlineStamps: settlement.mainlineStamps || {},
    bankPointsAdded: Number(settlement.bankPointsAdded || 0),
    reviewTimelinessBonus: Number(settlement.reviewTimelinessBonus || 0),
    pointsAdded: Number(settlement.pointsAdded),
    reviewDate: settlement.reviewDate || "",
    createdAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function deleteLatestSettlement(uid, settlement, fallbackProfile) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "settlements", settlement.id));
  batch.update(userDoc(uid), {
    points: increment(-Number(settlement.pointsAdded || 0)),
    todayBalanceMinutes: Number(fallbackProfile.todayBalanceMinutes || 0),
    nextDayBaseEntertainmentLimit: Number(fallbackProfile.nextDayBaseEntertainmentLimit || 60),
    nextDayEntertainmentLimitReason: fallbackProfile.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: fallbackProfile.nextDayEntertainmentSourceDayType || "normal_progress_day",
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

export async function rollbackSettlementsTo(uid, settlementsToDelete, targetSettlement) {
  const batch = writeBatch(db);
  const pointsToRemove = settlementsToDelete.reduce((sum, item) => sum + Number(item.pointsAdded || 0), 0);

  settlementsToDelete.forEach((settlement) => {
    batch.delete(doc(db, "users", uid, "settlements", settlement.id));
  });

  batch.update(userDoc(uid), {
    points: increment(-pointsToRemove),
    todayBalanceMinutes: Number(targetSettlement.generatedMinutes || 0),
    nextDayBaseEntertainmentLimit: Number(targetSettlement.nextDayBaseEntertainmentLimit || 60),
    nextDayEntertainmentLimitReason: targetSettlement.nextDayEntertainmentLimitReason || "",
    nextDayEntertainmentSourceDayType: targetSettlement.nextDayEntertainmentSourceDayType || "normal_progress_day",
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
}

export async function deleteLatestRedemption(uid, redemption, product) {
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "redemptions", redemption.id));
  batch.update(userDoc(uid), {
    points: increment(Number(redemption.price || 0)),
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
