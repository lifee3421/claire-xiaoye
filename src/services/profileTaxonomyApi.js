import { auth } from "./firebase";

export async function saveClassificationTaxonomyViaApi(classificationTaxonomy) {
  const user = auth.currentUser;
  if (!user) throw new Error("登录状态不可用，请重新登录后再保存分类。");
  const token = await user.getIdToken();
  const response = await fetch("/api/profile-taxonomy", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ classificationTaxonomy }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.error || `分类保存失败（HTTP ${response.status}）`);
  }
  return data;
}
