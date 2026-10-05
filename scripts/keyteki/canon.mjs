// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// Canonical text of a lambda: shared by the dump (frequency tables) and the lambda-map lookup.

/** Canonical source-like text: params renamed positionally (p0, p1…), whitespace-free, literals kept. */
export function canonOf(n, env = {}) {
  if (!n) return "";
  switch (n.t) {
    case "lit":
      return JSON.stringify(n.v) ?? "undefined";
    case "id":
      return env[n.name] ?? n.name;
    case "member":
      return `${canonOf(n.obj, env)}.${n.prop}`;
    case "index":
      return `${canonOf(n.obj, env)}[${canonOf(n.prop, env)}]`;
    case "call":
      return `${canonOf(n.callee, env)}(${n.args.map((a) => canonOf(a, env)).join(",")})`;
    case "action":
    case "effect":
      return `${n.t}.${n.name}(${n.args.map((a) => canonOf(a, env)).join(",")})`;
    case "bin":
    case "logic":
      return `(${canonOf(n.l, env)}${n.op}${canonOf(n.r, env)})`;
    case "un":
      return `${n.op}${canonOf(n.arg, env)}`;
    case "cond":
      return `(${canonOf(n.test, env)}?${canonOf(n.then, env)}:${canonOf(n.else, env)})`;
    case "obj":
      return `{${Object.keys(n.props).sort().map((k) => `${k}:${canonOf(n.props[k], env)}`).join(",")}}`;
    case "arr":
      return `[${n.items.map((a) => canonOf(a, env)).join(",")}]`;
    case "fn": {
      const inner = { ...env };
      n.params.forEach((p, i) => (inner[p] = `p${i}`));
      return `(${n.params.map((_, i) => `p${i}`).join(",")})=>${canonOf(n.body, inner)}`;
    }
    case "block": {
      // Block bodies stay textual: rename params by word, drop whitespace.
      let s = n.src.replace(/\s+/g, " ");
      for (const [from, to] of Object.entries(env)) s = s.replace(new RegExp(`\\b${from}\\b`, "g"), to);
      return s;
    }
    default:
      return String(n.src ?? n.t).replace(/\s+/g, " ").slice(0, 120);
  }
}
