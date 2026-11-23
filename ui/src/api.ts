export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok || result?.error) throw new Error(result?.error || `HTTP ${response.status}`);
  return result as T;
}
export async function downloadSession(session: string) {
  const response = await fetch(`/api/sessions/export?${new URLSearchParams({ session })}`);
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `ccglass-session-${session.replace(/\//g, "_")}.json`;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
export function exportRequest(id: string, format: string) {
  return `/api/export?${new URLSearchParams({ id, format })}`;
}
