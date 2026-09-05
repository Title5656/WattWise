// Only live forms register here; drafts never cross accounts or enter this registry.
const forms = new Set<symbol>();

export function registerUnsavedForm() {
  const key = Symbol();
  forms.add(key);
  return () => { forms.delete(key); };
}

export function hasUnsavedForms() {
  return forms.size > 0;
}
