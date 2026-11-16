export async function generateAudio(settings) {
  const response = await fetch("/api/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => null);
    throw new Error(result?.message || "Synthesis failed.");
  }
  return response.arrayBuffer();
}
