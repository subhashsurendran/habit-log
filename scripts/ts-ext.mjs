export async function resolve(specifier, context, nextResolve) {
  const relative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExt = /\.[a-zA-Z0-9]+$/.test(specifier);
  const parent = context.parentURL ?? "";
  if (relative && !hasExt && parent.includes("/workspace/src/")) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}
