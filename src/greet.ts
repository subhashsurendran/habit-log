export function greetingLine(name: string, now = new Date()): string {
  const hour = now.getHours();
  const hello =
    hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : hour < 21 ? "Good evening" : "Good night";
  return `${hello}, ${name}.`;
}
