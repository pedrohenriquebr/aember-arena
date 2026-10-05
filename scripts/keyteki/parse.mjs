// SPDX-License-Identifier: AGPL-3.0-only
// Derived from keyteki card scripts (copyright keyteki contributors, AGPL-3.0).
// AST reader for a keyteki card file (docs/KEYTEKI_CONVERSION_PLAN.md §1.1): turns
// `server/game/cards/<set>/<Card>.js` into a JSON-able CardIR. It does not know
// our DSL — lower.mjs does. Expression nodes are normalised to a small tree:
//   obj{props} arr{items} lit{v} id{name} member{obj,prop} call{callee,args}
//   action{name,args} effect{name,args} fn{params,body} bin/logic/un/cond/tpl
//   unknown{src}   (anything the lowering library has no business reading)
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { parse } from "acorn";

const CARD_BASES = new Set(["Card"]);

/** Converts an acorn node to the normalised tree. `src` is the file text, kept for `unknown` nodes. */
function expr(node, src) {
  if (!node) return { t: "lit", v: undefined };
  switch (node.type) {
    case "Literal":
      return { t: "lit", v: node.value };
    case "Identifier":
      return { t: "id", name: node.name };
    case "ThisExpression":
      return { t: "id", name: "this" };
    case "TemplateLiteral":
      return node.expressions.length ? { t: "tpl", src: src.slice(node.start, node.end) } : { t: "lit", v: node.quasis[0].value.cooked };
    case "ObjectExpression": {
      const props = {};
      const spreads = [];
      for (const p of node.properties) {
        if (p.type === "SpreadElement") {
          spreads.push(expr(p.argument, src));
          continue;
        }
        const key = p.computed ? null : p.key.type === "Identifier" ? p.key.name : String(p.key.value);
        if (key === null) {
          spreads.push({ t: "unknown", src: src.slice(p.start, p.end) });
          continue;
        }
        props[key] = p.kind === "get" || p.kind === "set" ? { t: "unknown", src: src.slice(p.start, p.end) } : p.method ? fn(p.value, src) : expr(p.value, src);
      }
      return spreads.length ? { t: "obj", props, spreads } : { t: "obj", props };
    }
    case "ArrayExpression":
      return { t: "arr", items: node.elements.map((e) => (e ? (e.type === "SpreadElement" ? { t: "unknown", src: src.slice(e.start, e.end) } : expr(e, src)) : { t: "lit", v: null })) };
    case "ArrowFunctionExpression":
    case "FunctionExpression":
      return fn(node, src);
    case "MemberExpression": {
      const obj = expr(node.object, src);
      if (node.computed) {
        const prop = expr(node.property, src);
        return prop.t === "lit" ? { t: "member", obj, prop: String(prop.v) } : { t: "index", obj, prop };
      }
      return { t: "member", obj, prop: node.property.name };
    }
    case "CallExpression": {
      const a = actionCall(node, src);
      if (a) return a;
      return { t: "call", callee: expr(node.callee, src), args: node.arguments.map((x) => expr(x, src)) };
    }
    case "BinaryExpression":
      return { t: "bin", op: node.operator, l: expr(node.left, src), r: expr(node.right, src) };
    case "LogicalExpression":
      return { t: "logic", op: node.operator, l: expr(node.left, src), r: expr(node.right, src) };
    case "UnaryExpression":
      return { t: "un", op: node.operator, arg: expr(node.argument, src) };
    case "ConditionalExpression":
      return { t: "cond", test: expr(node.test, src), then: expr(node.consequent, src), else: expr(node.alternate, src) };
    case "ChainExpression":
      return expr(node.expression, src);
    default:
      return { t: "unknown", src: src.slice(node.start, node.end) };
  }
}

/** `ability.actions.X(args)` / `ability.effects.X(args)`; null for any other call. */
function actionCall(node, src) {
  const c = node.callee;
  if (c.type !== "MemberExpression" || c.computed || c.property.type !== "Identifier") return null;
  const owner = c.object;
  if (owner.type !== "MemberExpression" || owner.computed || owner.object.type !== "Identifier" || owner.object.name !== "ability") return null;
  const kind = owner.property.name === "actions" ? "action" : owner.property.name === "effects" ? "effect" : null;
  if (!kind) return null;
  return { t: kind, name: c.property.name, args: node.arguments.map((x) => expr(x, src)) };
}

function fn(node, src) {
  const params = node.params.map((p) => (p.type === "Identifier" ? p.name : p.type === "ObjectPattern" ? "{}" : p.type === "AssignmentPattern" && p.left.type === "Identifier" ? p.left.name : "?"));
  let body;
  if (node.body.type !== "BlockStatement") body = expr(node.body, src);
  else if (node.body.body.length === 1 && node.body.body[0].type === "ReturnStatement") body = expr(node.body.body[0].argument, src);
  else body = { t: "block", src: src.slice(node.body.start, node.body.end) };
  return { t: "fn", params, body };
}

/** Class bodies: setupCardAbilities statements → registrations; anything else is a flag. */
export function parseCardSource(source, file = "<memory>") {
  const comments = [];
  const ast = parse(source, { ecmaVersion: 2022, sourceType: "script", locations: true, onComment: comments, allowReturnOutsideFunction: true });
  const ir = { file: basename(file), set: null, id: null, className: null, header: "", regs: [], flags: { customMethods: false, registrar: false, noSetup: false, extendsOther: false, complexSetup: false } };

  const cls = ast.body.find((n) => n.type === "ClassDeclaration");
  if (!cls) {
    ir.flags.noSetup = true;
    return ir;
  }
  ir.className = cls.id.name;
  if (!cls.superClass || cls.superClass.type !== "Identifier" || !CARD_BASES.has(cls.superClass.name)) ir.flags.extendsOther = true;

  // `Anger.id = 'anger'`
  for (const n of ast.body) {
    if (n.type !== "ExpressionStatement" || n.expression.type !== "AssignmentExpression") continue;
    const l = n.expression.left;
    if (l.type === "MemberExpression" && l.object.name === cls.id.name && l.property.name === "id" && n.expression.right.type === "Literal") ir.id = n.expression.right.value;
  }

  let setup = null;
  for (const m of cls.body.body) {
    if (m.type !== "MethodDefinition") continue;
    const name = m.key.name;
    if (name === "setupCardAbilities") setup = m;
    else if (name === "constructor") ir.flags.registrar = true;
    else ir.flags.customMethods = true;
  }
  if (source.includes("EventRegistrar")) ir.flags.registrar = true;
  if (!setup) {
    ir.flags.noSetup = true;
    return ir;
  }

  // Header = the `//` comments between the class opening and the method.
  const lines = comments.filter((c) => c.start > cls.body.start && c.end <= setup.start).map((c) => c.value.trim());
  ir.header = lines.join("\n");

  for (const st of setup.value.body.body) {
    const call = st.type === "ExpressionStatement" && st.expression.type === "CallExpression" ? st.expression : null;
    const callee = call?.callee;
    if (call && callee.type === "MemberExpression" && callee.object.type === "ThisExpression" && !callee.computed) {
      ir.regs.push({ registrar: callee.property.name, args: call.arguments.map((a) => expr(a, source)), line: st.loc.start.line });
    } else {
      ir.flags.complexSetup = true;
    }
  }
  return ir;
}

export function parseCardFile(path) {
  const ir = parseCardSource(readFileSync(path, "utf8"), path);
  const m = /[\\/]cards[\\/]([^\\/]+)[\\/]/.exec(path);
  ir.set = m ? m[1] : null;
  return ir;
}
