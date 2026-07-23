export async function runAutoDraftSave({ formalSavingRef, save, payload, onSuccess, onError }) {
  if (formalSavingRef.current) return false;
  try {
    await save(payload);
    if (!formalSavingRef.current) onSuccess?.();
    return !formalSavingRef.current;
  } catch (error) {
    if (!formalSavingRef.current) onError?.(error);
    return false;
  }
}
