/**
 * analyzer.ts — semantic analysis: builds a DocumentModel (symbol tables,
 * type information and diagnostics) from the parse result.
 *
 * Responsibilities (each single-purpose):
 *  - declaration registration & duplicate detection
 *  - name resolution (variables, procedures, functions, types, classes, fields)
 *  - lightweight literal-driven type inference & compatibility checking
 *  - producing descriptive diagnostics for common student mistakes
 *
 * The analyzer never talks to the LSP: it works on plain ranges and symbols,
 * which the provider layer converts to protocol types (DIP).
 */

import {
  AssignStmt,
  BinaryExpr,
  CallExpr,
  ClassDecl,
  ConstDecl,
  DefineStmt,
  DerefExpr,
  Expression,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  IndexExpr,
  InputStmt,
  MemberExpr,
  OpenFileStmt,
  Pos,
  ProcedureDecl,
  Program,
  RangeExpr,
  RepeatStmt,
  ReturnStmt,
  Statement,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
  Declaration,
} from './ast';
import { BUILTIN_FUNCTIONS } from './lexicon';
import { isSyntheticName, parse, ParseResult } from './parser';
import { Token } from './scanner';

// ------------------------------------------------------------------ symbols

export type SymbolKind =
  | 'variable' | 'constant' | 'procedure' | 'function' | 'parameter'
  | 'property' | 'type' | 'class' | 'field' | 'enum' | 'builtin' | 'loop';

export interface SymbolInfo {
  name: string;
  kind: SymbolKind;
  /** Human-readable type, e.g. "INTEGER", "ARRAY[1:30] OF STRING", "StudentRecord". */
  typeText: string;
  /** For inference: the AST type expression from the declaration (if any). */
  typeExpr: TypeExpr | null;
  namePos: Pos;
  declRange: { start: Pos; end: Pos };
  scope: Scope;
  declNode: TypeDecl | ClassDecl | ProcedureDecl | FunctionDecl | VarDecl | ConstDecl | null;
  members: Map<string, SymbolInfo>;
  /** For classes: name of the superclass. */
  inherits: string | null;
}

// -------------------------------------------------------------------- scope

export class Scope {
  readonly symbols = new Map<string, SymbolInfo>();
  constructor(readonly parent: Scope | null, readonly owner: string | null = null) {}

  /**
   * Identifiers are case-insensitive (§2.3: “Countdown and CountDown should
   * not be used as separate variable names”), so resolution is exact-first,
   * then case-insensitive.
   */
  resolve(name: string): SymbolInfo | undefined {
    let s: Scope | null = this;
    while (s) {
      const exact = s.symbols.get(name);
      if (exact) return exact;
      const lower = name.toLowerCase();
      for (const [key, sym] of s.symbols) {
        if (key.toLowerCase() === lower) return sym;
      }
      s = s.parent;
    }
    return undefined;
  }

  declareLocal(info: SymbolInfo): SymbolInfo | undefined {
    const existing = this.symbols.get(info.name) ?? this.caseInsensitiveHit(info.name);
    if (existing) return existing;
    this.symbols.set(info.name, info);
    return undefined;
  }

  private caseInsensitiveHit(name: string): SymbolInfo | undefined {
    const lower = name.toLowerCase();
    for (const [key, sym] of this.symbols) {
      if (key.toLowerCase() === lower) return sym;
    }
    return undefined;
  }
}

// ------------------------------------------------------------------- issues

export type IssueSeverity = 'error' | 'warning' | 'hint';

export interface Issue {
  message: string;
  range: { start: Pos; end: Pos };
  severity: IssueSeverity;
}

// --------------------------------------------------------------- document

export interface DocumentModel {
  uri: string;
  text: string;
  tokens: Token[];
  program: Program;
  issues: Issue[];
  globalScope: Scope;
  /** Every declared symbol in the document (for completion / outline). */
  allSymbols: SymbolInfo[];
  /** `line:char` of an identifier name → the symbol it resolved to. */
  nameResolutions: Map<string, SymbolInfo>;
}

const LITERAL_TYPES: Record<string, string> = {
  integer: 'INTEGER',
  real: 'REAL',
  string: 'STRING',
  char: 'CHAR',
  date: 'DATE',
  boolean: 'BOOLEAN',
};

/** Human-readable form of a type expression. */
/** Type *name* of a literal expression (e.g. "INTEGER", "STRING"); '' if unknown. */
export function typeNameOfExpr(e: Expression): string {
  return e.kind === 'LiteralExpr' ? (LITERAL_TYPES[e.literalKind] ?? '') : '';
}

export function typeNameOf(type: TypeExpr | null): string {
  if (!type) return '';
  switch (type.kind) {
    case 'TypeRef': return type.name;
    case 'ArrayType': {
      const dims = type.bounds.map((b) => `${exprText(b.low)}:${exprText(b.high)}`).join(',');
      return `ARRAY[${dims}] OF ${typeNameOf(type.element)}`;
    }
    case 'SetType': return `SET OF ${typeNameOf(type.element)}`;
    case 'PointerType': return `^${typeNameOf(type.target)}`;
  }
}

function exprText(e: Expression): string {
  return e.kind === 'LiteralExpr' ? e.text : '';
}

/** Build a URL-less model for a document (the standard entry point). */
export function analyze(uri: string, text: string): DocumentModel {
  const result: ParseResult = parse(text);
  const analyzer = new Analyzer(uri, text, result);
  return analyzer.build();
}

// ------------------------------------------------------------------ node ctx

interface Ctx {
  scope: Scope;
  /** Stack of enclosing class scopes (for SUPER resolution). */
  classes: Array<{ scope: Scope; name: string; inherits: string | null }>;
  functionScope: FunctionDecl | null;
}

class Analyzer {
  private readonly issues: Issue[] = [];
  private readonly model: DocumentModel;
  private readonly tokenIndex: Map<string, Token> = new Map();

  constructor(uri: string, text: string, private readonly result: ParseResult) {
    for (const t of result.tokens) this.tokenIndex.set(`${t.line}:${t.char}`, t);
    this.model = {
      uri,
      text,
      tokens: result.tokens,
      program: result.program,
      issues: this.issues,
      globalScope: new Scope(null, 'program'),
      allSymbols: [],
      nameResolutions: new Map(),
    };
  }

  build(): DocumentModel {
    const { issues, program } = this.result;
    for (const issue of issues) {
      this.issues.push({
        message: issue.message,
        range: { start: issue.pos, end: issue.end ?? { line: issue.pos.line, char: issue.pos.char + 1 } },
        severity: issue.severity,
      });
    }
    const ctx: Ctx = { scope: this.model.globalScope, classes: [], functionScope: null };
    for (const st of program.statements) this.analyzeTopLevel(st, ctx);
    return this.model;
  }

  // ------------------------------------------------------------ declarations

  private declare(
    ctx: Ctx,
    name: string,
    kind: SymbolKind,
    namePos: Pos,
    declRange: { start: Pos; end: Pos },
    typeText: string,
    typeExpr: TypeExpr | null,
    declNode: SymbolInfo['declNode']
  ): SymbolInfo | undefined {
    return this.declareIn(ctx.scope, name, kind, namePos, declRange, typeText, typeExpr, declNode);
  }

  /** Declare a symbol; reports on duplicate; returns it (or undefined on dup). */
  private declareIn(
    scope: Scope,
    name: string,
    kind: SymbolKind,
    namePos: Pos,
    declRange: { start: Pos; end: Pos },
    typeText: string,
    typeExpr: TypeExpr | null,
    declNode: SymbolInfo['declNode']
  ): SymbolInfo | undefined {
    if (isSyntheticName(name)) return undefined;
    const info: SymbolInfo = {
      name, kind, typeText, typeExpr, namePos, declRange,
      scope, declNode, members: new Map(), inherits: null,
    };
    if (declNode?.kind === 'ClassDecl') info.inherits = declNode.inherits;
    if (scope.declareLocal(info)) {
      this.err(`Duplicate declaration of '${name}'`, namePos, 'error');
      return undefined;
    }
    this.model.allSymbols.push(info);
    this.bindName(namePos, info);
    return info;
  }

  private buildTypeMembers(decl: TypeDecl, info: SymbolInfo): void {
    if (decl.form === 'record' && decl.recordFields) {
      for (const f of decl.recordFields) {
        info.members.set(f.name, {
          name: f.name, kind: 'field', typeText: typeNameOf(f.type), typeExpr: f.type,
          namePos: f.namePos, declRange: { start: f.start, end: f.end }, scope: info.scope,
          declNode: f, members: new Map(), inherits: null,
        });
      }
    } else if (decl.form === 'enum' && decl.enumValues) {
      for (const v of decl.enumValues) {
        const extent = { start: v.namePos, end: { line: v.namePos.line, char: v.namePos.char + v.name.length } };
        const vi: SymbolInfo = {
          name: v.name, kind: 'enum', typeText: decl.name, typeExpr: null,
          namePos: v.namePos, declRange: extent, scope: info.scope,
          declNode: null, members: new Map(), inherits: null,
        };
        info.members.set(v.name, vi);
        // Enumerated values are used bare in expressions (ThisSeason ← Spring).
        if (!this.model.globalScope.symbols.has(v.name)) this.model.globalScope.symbols.set(v.name, vi);
        this.model.allSymbols.push(vi);
        this.bindName(v.namePos, vi);
      }
    }
  }

  private buildClassMembers(decl: ClassDecl, info: SymbolInfo, outer: Ctx): void {
    const classBody: Scope = new Scope(info.scope, decl.name);
    const classCtx: Ctx = {
      scope: classBody,
      // Method bodies parent to the class-body scope so fields are visible.
      classes: [...outer.classes, { scope: classBody, name: decl.name, inherits: decl.inherits }],
      functionScope: null,
    };
    for (const m of decl.members) {
      switch (m.kind) {
        case 'VarDecl': {
          const mi = this.declareIn(classCtx.scope, m.name, 'property', m.namePos, { start: m.start, end: m.end }, typeNameOf(m.type), m.type, m);
          if (mi) info.members.set(m.name, mi);
          break;
        }
        case 'ConstDecl': {
          if (m.value.kind !== 'LiteralExpr') this.err('Only a literal may be used as the value of a constant (section 2.5)', m.value.start, 'error');
          const mi = this.declareIn(classCtx.scope, m.name, 'constant', m.namePos, { start: m.start, end: m.end }, typeNameOfExpr(m.value), null, m);
          if (mi) info.members.set(m.name, mi);
          break;
        }
        case 'ProcedureDecl':
        case 'FunctionDecl': {
          const mi = this.declareIn(classCtx.scope, m.name, m.kind === 'ProcedureDecl' ? 'procedure' : 'function', m.namePos, { start: m.start, end: m.end }, m.kind === 'FunctionDecl' ? typeNameOf(m.returns) : 'PROCEDURE', m.kind === 'FunctionDecl' ? m.returns : null, m);
          if (mi) {
            info.members.set(m.name, mi);
            this.analyzeCallable(m, mi, classCtx);
          }
          break;
        }
      }
    }
  }

  private analyzeTopLevel(st: Statement | Declaration, ctx: Ctx): void {
    switch (st.kind) {
      case 'VarDecl':
        this.declare(ctx, st.name, st.isProperty ? 'property' : 'variable', st.namePos, { start: st.start, end: st.end }, typeNameOf(st.type), st.type, st);
        break;
      case 'ConstDecl': {
        if (st.value.kind !== 'LiteralExpr') {
          this.err('Only a literal may be used as the value of a constant (section 2.5)', st.value.start, 'error');
          this.analyzeExpr(st.value, ctx);
        } else {
          this.declare(ctx, st.name, 'constant', st.namePos, { start: st.start, end: st.end }, typeNameOfExpr(st.value), null, st);
        }
        break;
      }
      case 'TypeDecl': {
        const info = this.declare(ctx, st.name, 'type', st.namePos, { start: st.start, end: st.end }, st.name, null, st);
        if (info) this.buildTypeMembers(st, info);
        break;
      }
      case 'DefineStmt':
        this.declare(ctx, st.name, 'constant', st.namePos, { start: st.start, end: st.end }, st.typeName, null, null);
        break;
      case 'ProcedureDecl':
      case 'FunctionDecl': {
        const info = this.declare(
          ctx, st.name,
          st.kind === 'ProcedureDecl' ? 'procedure' : 'function',
          st.namePos, { start: st.start, end: st.end },
          st.kind === 'FunctionDecl' ? typeNameOf(st.returns) : 'PROCEDURE',
          st.kind === 'FunctionDecl' ? st.returns : null,
          st
        );
        if (info) this.analyzeCallable(st, info, ctx);
        break;
      }
      case 'ClassDecl': {
        const info = this.declare(ctx, st.name, 'class', st.namePos, { start: st.start, end: st.end }, st.name, null, st);
        if (!info) break;
        if (st.inherits) {
          const parent = ctx.scope.resolve(st.inherits);
          if (!parent || parent.kind !== 'class') {
            this.err(`Unknown superclass '${st.inherits}'`, st.inheritsPos ?? st.namePos, 'error');
          }
        }
        this.buildClassMembers(st, info, ctx);
        break;
      }
      default:
        this.analyzeStatement(st, ctx);
    }
  }

  private analyzeCallable(st: ProcedureDecl | FunctionDecl, info: SymbolInfo, outer: Ctx): void {
    if (st.kind === 'FunctionDecl' && !st.returns) {
      this.err(`Function '${st.name}' must declare a return type after 'RETURNS'`, st.namePos, 'error');
    }
    // Method bodies may reference fields/methods of the enclosing class.
    const bodyScope = new Scope(outer.classes.length ? outer.classes[outer.classes.length - 1].scope : outer.scope, st.name);
    info.scope = bodyScope;
    for (const p of st.params) {
      if (isSyntheticName(p.name)) continue;
      if (bodyScope.symbols.has(p.name)) this.err(`Duplicate parameter '${p.name}'`, p.namePos, 'error');
      const pi: SymbolInfo = {
        name: p.name, kind: 'parameter', typeText: typeNameOf(p.type), typeExpr: p.type,
        namePos: p.namePos, declRange: { start: p.start, end: p.end },
        scope: bodyScope, declNode: null, members: new Map(), inherits: null,
      };
      bodyScope.symbols.set(p.name, pi);
      this.model.allSymbols.push(pi);
      this.bindName(p.namePos, pi);
      if (st.kind === 'FunctionDecl' && p.byRef) {
        this.err('Parameters should not be passed by reference to a function (section 8.3)', p.start, 'warning');
      }
    }
    const bodyCtx: Ctx = { scope: bodyScope, classes: outer.classes, functionScope: st.kind === 'FunctionDecl' ? st : null };
    for (const bodySt of st.body) this.analyzeStatement(bodySt, bodyCtx);
  }

  // -------------------------------------------------------------- statements

  private analyzeStatement(st: Statement | Declaration, ctx: Ctx): void {
    switch (st.kind) {
      case 'InputStmt':
        this.implicitDeclareTarget(st.target, ctx);
        this.analyzeExpr(st.target, ctx);
        this.requireVariableTarget(st.target, ctx, 'INPUT requires a variable');
        break;
      case 'OutputStmt':
        for (const a of st.args) this.analyzeExpr(a, ctx);
        break;
      case 'CallStmt': {
        const sym = ctx.scope.resolve(st.name);
        if (!sym || sym.kind === 'variable' || sym.kind === 'loop') {
          this.err(`Unknown procedure '${st.name}' — is it declared with PROCEDURE?`, st.namePos, 'error');
        } else if (sym.kind !== 'procedure') {
          this.err(`'${st.name}' is a ${sym.kind} — use CALL only for procedures`, st.namePos, 'warning');
        } else {
          this.bindName(st.namePos, sym);
          this.checkArity(sym, st.namePos, st.args, ctx);
          for (const a of st.args) this.analyzeExpr(a, ctx);
        }
        break;
      }
      case 'ReturnStmt': {
        if (!ctx.functionScope) {
          this.err('RETURN is only allowed inside a FUNCTION', st.start, 'warning');
        }
        if (st.value) {
          const vt = this.analyzeExpr(st.value, ctx);
          if (ctx.functionScope?.returns) {
            this.checkValueCompat('function result', vt, ctx.functionScope.returns, st.start);
          }
        } else if (ctx.functionScope) {
          this.err('RETURN should return a value matching the declared return type', st.start, 'warning');
        }
        break;
      }
      case 'OpenFileStmt':
        this.analyzeExpr(st.file, ctx);
        break;
      case 'ReadFileStmt':
        this.analyzeExpr(st.file, ctx);
        this.analyzeExpr(st.target, ctx);
        break;
      case 'WriteFileStmt':
        this.analyzeExpr(st.file, ctx);
        this.analyzeExpr(st.data, ctx);
        break;
      case 'CloseFileStmt':
        this.analyzeExpr(st.file, ctx);
        break;
      case 'SeekStmt':
        this.analyzeExpr(st.file, ctx);
        this.analyzeExpr(st.address, ctx);
        break;
      case 'GetRecordStmt':
      case 'PutRecordStmt':
        this.analyzeExpr(st.file, ctx);
        this.analyzeExpr(st.target, ctx);
        break;
      case 'IfStmt': {
        this.checkCondition(st.condition, ctx);
        const ifScope = new Scope(ctx.scope, 'IF');
        const ctx1: Ctx = { ...ctx, scope: ifScope };
        for (const s of st.thenBody) this.analyzeStatement(s, ctx1);
        if (st.elseBody) {
          const ctx2: Ctx = { ...ctx, scope: new Scope(ifScope, 'ELSE') };
          for (const s of st.elseBody) this.analyzeStatement(s, ctx2);
        }
        break;
      }
      case 'CaseStmt': {
        this.analyzeExpr(st.subject, ctx);
        const inner: Ctx = { ...ctx, scope: new Scope(ctx.scope, 'CASE') };
        for (const b of st.branches) {
          for (const v of b.values) this.analyzeCaseValue(v, inner);
          for (const s of b.body) this.analyzeStatement(s, inner);
        }
        if (st.otherwise) for (const s of st.otherwise) this.analyzeStatement(s, inner);
        break;
      }
      case 'ForStmt': {
        this.analyzeExpr(st.from, ctx);
        this.analyzeExpr(st.to, ctx);
        if (st.step) this.analyzeExpr(st.step, ctx);
        const inner: Ctx = { ...ctx, scope: new Scope(ctx.scope, `FOR ${st.variable}`) };
        if (!isSyntheticName(st.variable)) {
          const li: SymbolInfo = {
            name: st.variable, kind: 'loop', typeText: 'INTEGER', typeExpr: null,
            namePos: st.variablePos, declRange: { start: st.variablePos, end: st.variablePos },
            scope: inner.scope, declNode: null, members: new Map(), inherits: null,
          };
          if (inner.scope.declareLocal(li)) this.err(`Duplicate declaration of '${st.variable}'`, st.variablePos, 'error');
          this.model.allSymbols.push(li);
          this.bindName(st.variablePos, li);
        }
        for (const s of st.body) this.analyzeStatement(s, inner);
        if (st.nextVar && st.nextVar !== st.variable) {
          this.err(`NEXT ${st.nextVar} does not match the loop variable '${st.variable}'`, st.nextVarPos ?? st.variablePos, 'error');
        }
        break;
      }
      case 'RepeatStmt': {
        const inner: Ctx = { ...ctx, scope: new Scope(ctx.scope, 'REPEAT') };
        for (const s of st.body) this.analyzeStatement(s, inner);
        this.checkCondition(st.condition, inner);
        break;
      }
      case 'WhileStmt': {
        this.checkCondition(st.condition, ctx);
        const inner: Ctx = { ...ctx, scope: new Scope(ctx.scope, 'WHILE') };
        for (const s of st.body) this.analyzeStatement(s, inner);
        break;
      }
      case 'AssignStmt': {
        // Declare the target first so reads in the value (X ← X + 1) resolve.
        this.implicitDeclareTarget(st.target, ctx);
        const vt = this.analyzeExpr(st.value, ctx);
        this.checkAssignmentTarget(st.target, vt, ctx);
        this.analyzeExpr(st.target, ctx);
        break;
      }
      case 'ExprStmt':
        this.analyzeExpr(st.expr, ctx);
        if (st.expr.kind === 'CallExpr' && st.expr.callee.kind === 'IdentifierExpr' && !st.expr.isNew) {
          const calleeSym = ctx.scope.resolve(st.expr.callee.name);
          if (calleeSym?.kind === 'procedure') {
            this.err(`Call procedures with CALL: CALL ${st.expr.callee.name}(…)`, st.expr.start, 'warning');
          } else if (!calleeSym || calleeSym.kind !== 'function') {
            this.err('A statement cannot be just an expression (are you missing CALL?)', st.expr.start, 'hint');
          }
        }
        break;
      default:
        this.analyzeTopLevel(st, ctx);
    }
  }

  private checkCondition(cond: Expression, ctx: Ctx): void {
    const t = this.analyzeExpr(cond, ctx);
    if (t && t !== 'BOOLEAN' && t !== '') this.err(`Condition must evaluate to a BOOLEAN value (found ${t})`, cond.start, 'error');
  }

  private analyzeCaseValue(v: Expression | RangeExpr, ctx: Ctx): void {
    if (v.kind === 'RangeExpr') {
      this.analyzeExpr(v.from, ctx);
      this.analyzeExpr(v.to, ctx);
      return;
    }
    if (v.kind === 'IdentifierExpr') {
      const sym = ctx.scope.resolve(v.name);
      if (!sym && !isSyntheticName(v.name)) this.err(`Unknown case value '${v.name}'`, v.start, 'hint');
    } else {
      this.analyzeExpr(v, ctx);
    }
  }

  /**
   * Pseudocode allows implicit variables — the guide says DECLARE is *good
   * practice* (section 2.4), not a requirement. Assigning to (or INPUT into)
   * an unknown name therefore declares the variable implicitly, with a gentle
   * hint to declare it explicitly. Unknown names in *read* positions are still
   * reported — that is where typos surface.
   */
  private implicitDeclareTarget(target: Expression, ctx: Ctx): void {
    let root: Expression = target;
    if (target.kind === 'IndexExpr') root = target.base;
    if (target.kind === 'MemberExpr') root = target.base;
    if (target.kind === 'DerefExpr') root = target.base;
    if (root.kind !== 'IdentifierExpr' || isSyntheticName(root.name)) return;
    if (ctx.scope.resolve(root.name)) return; // already visible somewhere
    const info: SymbolInfo = {
      name: root.name, kind: 'variable', typeText: '', typeExpr: null,
      namePos: root.namePos, declRange: { start: root.namePos, end: root.namePos },
      scope: ctx.scope, declNode: null, members: new Map(), inherits: null,
    };
    ctx.scope.symbols.set(root.name, info);
    this.model.allSymbols.push(info);
    this.bindName(root.namePos, info);
    this.err(`No DECLARE for '${root.name}' — declaring it implicitly (good practice: add DECLARE ${root.name} : …)`, root.namePos, 'hint');
  }

  private requireVariableTarget(target: Expression, ctx: Ctx, message: string): void {
    if (target.kind === 'IdentifierExpr') {
      const sym = ctx.scope.resolve(target.name);
      if (sym && ['function', 'procedure', 'type', 'class', 'constant'].includes(sym.kind)) {
        this.err(message, target.start, 'error');
      }
    }
  }

  private checkAssignmentTarget(target: Expression, valueType: string, ctx: Ctx): void {
    switch (target.kind) {
      case 'IdentifierExpr': {
        const sym = ctx.scope.resolve(target.name);
        if (!sym) return; // unknown identifier report comes from analyzeExpr
        if (sym.kind === 'constant' || sym.kind === 'enum') {
          this.err(`Cannot assign a value to the ${sym.kind === 'constant' ? 'constant' : 'enumerated value'} '${sym.name}'`, target.start, 'error');
        } else if (!['variable', 'loop', 'parameter', 'property', 'field'].includes(sym.kind)) {
          this.err(`Cannot assign a value to a ${sym.kind}`, target.start, 'error');
        } else {
          this.checkValueCompat(sym.name, valueType, sym.typeExpr, target.start);
        }
        break;
      }
      case 'IndexExpr': {
        const baseSym = this.baseSymbol(target.base, ctx);
        const elem = baseSym && this.arrayElement(baseSym);
        if (baseSym && !elem) {
          this.err(`Cannot index a value of type ${baseSym.typeText || 'unknown'}`, target.start, 'error');
        } else if (elem) {
          this.checkValueCompat(baseSym!.name, valueType, elem, target.start);
        }
        break;
      }
      case 'MemberExpr': {
        const member = this.resolveMember(target, ctx);
        if (member && (member.kind === 'property' || member.kind === 'field')) {
          this.checkValueCompat(member.name, valueType, member.typeExpr, target.start);
        } else if (member) {
          this.err(`Cannot assign to '${member.name}' (not a property)`, target.memberPos, 'error');
        }
        break;
      }
      case 'DerefExpr': {
        const baseSym = this.baseSymbol(target.base, ctx);
        if (baseSym?.typeExpr?.kind === 'PointerType') {
          this.checkValueCompat(baseSym.name, valueType, baseSym.typeExpr.target, target.start);
        }
        break;
      }
      default:
        this.err('Invalid assignment target (expected a variable, array element or member)', target.start, 'error');
    }
  }

  /**
   * Weak literal-driven compatibility check: only fires when both sides are
   * known with certainty, to avoid false positives on valid student code.
   */
  private checkValueCompat(what: string, got: string, declared: TypeExpr | null, at: Pos): void {
    if (!declared || declared.kind !== 'TypeRef' || !got) return;
    const decl = declared.name;
    if (got === decl) return;
    if (got === 'INTEGER' && decl === 'REAL') return; // widening is allowed
    if (got === 'CHAR' && decl === 'STRING') return;
    if (got === 'DATE' && decl === 'STRING') return;
    this.err(`Type mismatch: cannot assign a ${got} value to '${what}' declared as ${decl}`, at, 'error');
  }

  // ------------------------------------------------------ lvalue / membership

  private baseSymbol(base: Expression, ctx: Ctx): SymbolInfo | undefined {
    if (base.kind === 'IdentifierExpr') return ctx.scope.resolve(base.name);
    if (base.kind === 'IndexExpr') return this.baseSymbol(base.base, ctx);
    return undefined;
  }

  private arrayElement(sym: SymbolInfo): TypeExpr | undefined {
    return sym.typeExpr?.kind === 'ArrayType' ? sym.typeExpr.element : undefined;
  }

  /** Resolve `base.member` where base is an object/record/pointer expression. */
  private resolveMember(m: MemberExpr, ctx: Ctx): SymbolInfo | undefined {
    if (m.base.kind === 'IdentifierExpr' && m.base.name === 'SUPER') {
      const cls = ctx.classes[ctx.classes.length - 1];
      if (cls?.inherits) {
        const parent = ctx.scope.resolve(cls.inherits);
        if (parent?.kind === 'class') return this.memberInChain(parent, m.member, ctx);
      }
      return undefined;
    }
    const baseType = this.typeOfExpr(m.base, ctx);
    if (!baseType) return undefined;
    const sym = ctx.scope.resolve(baseType);
    if (!sym) return undefined;
    if (sym.kind === 'type' && sym.declNode?.kind === 'TypeDecl') return sym.members.get(m.member);
    if (sym.kind === 'class') return this.memberInChain(sym, m.member, ctx);
    return undefined;
  }

  /** Class member lookup that walks the INHERITS chain (guide §10.2). */
  private memberInChain(start: SymbolInfo, member: string, ctx: Ctx): SymbolInfo | undefined {
    const visited = new Set<string>();
    let cur: SymbolInfo | undefined = start;
    while (cur && cur.kind === 'class' && !visited.has(cur.name)) {
      visited.add(cur.name);
      const hit = cur.members.get(member);
      if (hit) return hit;
      cur = cur.inherits ? ctx.scope.resolve(cur.inherits) : undefined;
    }
    return undefined;
  }

  // ---------------------------------------------------------------- analysis

  /** Returns the inferred type NAME ('' if unknown). Also reports diagnostics. */
  private analyzeExpr(e: Expression, ctx: Ctx): string {
    switch (e.kind) {
      case 'LiteralExpr':
        return LITERAL_TYPES[e.literalKind] ?? '';
      case 'IdentifierExpr':
        return this.analyzeIdentifier(e, ctx);
      case 'UnaryExpr':
        return this.analyzeUnary(e, ctx);
      case 'BinaryExpr':
        return this.analyzeBinary(e, ctx);
      case 'CallExpr':
        return this.analyzeCall(e, ctx);
      case 'IndexExpr': {
        for (const i of e.indices) this.analyzeExpr(i, ctx);
        const baseSym = this.baseSymbol(e.base, ctx);
        const elem = baseSym && this.arrayElement(baseSym);
        if (baseSym && baseSym.typeExpr && !elem) {
          this.err(`Cannot index a value of type ${baseSym.typeText || 'unknown'}`, e.start, 'error');
        }
        return elem ? typeNameOf(elem) : '';
      }
      case 'MemberExpr': {
        if (!(e.base.kind === 'IdentifierExpr' && e.base.name === 'SUPER')) this.analyzeExpr(e.base, ctx);
        const member = this.resolveMember(e, ctx);
        if (member) {
          this.bindName(e.memberPos, member);
          return member.typeText;
        }
        // A known record/class type with a missing member is a mistake worth flagging.
        const baseType = this.typeOfExpr(e.base, ctx);
        if (baseType) {
          const bt = ctx.scope.resolve(baseType);
          const isStruct = (bt?.kind === 'type' && bt.declNode?.kind === 'TypeDecl') || bt?.kind === 'class';
          if (isStruct) this.err(`Type ${baseType} has no member '${e.member}'`, e.memberPos, 'error');
        }
        return '';
      }
      case 'DerefExpr': {
        const baseSym = this.baseSymbol(e.base, ctx);
        if (baseSym?.typeExpr?.kind === 'PointerType') return typeNameOf(baseSym.typeExpr.target);
        return '';
      }
    }
  }

  private analyzeIdentifier(e: IdentifierExpr, ctx: Ctx): string {
    if (isSyntheticName(e.name)) return '';
    const sym = ctx.scope.resolve(e.name);
    if (sym) {
      this.bindName(e.namePos, sym);
      return this.typeOfSymbol(sym);
    }
    this.err(`Unknown identifier '${e.name}'`, e.namePos, 'error');
    return '';
  }

  private typeOfSymbol(sym: SymbolInfo): string {
    if (sym.kind === 'function') return sym.typeText; // return type
    if (sym.kind === 'type' || sym.kind === 'class') return sym.name;
    return sym.typeText;
  }

  private analyzeUnary(e: UnaryExpr, ctx: Ctx): string {
    const t = this.analyzeExpr(e.operand, ctx);
    if (e.op === 'NOT') {
      if (t && t !== 'BOOLEAN') this.err(`NOT operates on BOOLEAN values (found ${t})`, e.start, 'error');
      return 'BOOLEAN';
    }
    if (e.op === '^') return ''; // address-of: type is a pointer — leave inference open
    return t;
  }

  private analyzeBinary(e: BinaryExpr, ctx: Ctx): string {
    const l = this.analyzeExpr(e.left, ctx);
    const r = this.analyzeExpr(e.right, ctx);
    switch (e.op) {
      case 'AND': case 'OR':
        if (l && l !== 'BOOLEAN') this.err(`${e.op} requires BOOLEAN operands (found ${l})`, e.left.start, 'error');
        if (r && r !== 'BOOLEAN') this.err(`${e.op} requires BOOLEAN operands (found ${r})`, e.right.start, 'error');
        return 'BOOLEAN';
      case '=': case '<>': case '<': case '>': case '<=': case '>=':
        return 'BOOLEAN';
      case '&':
        if (l && (l === 'INTEGER' || l === 'REAL' || l === 'BOOLEAN')) this.err(`'&' concatenates text values (found ${l})`, e.left.start, 'error');
        if (r && (r === 'INTEGER' || r === 'REAL' || r === 'BOOLEAN')) this.err(`'&' concatenates text values (found ${r})`, e.right.start, 'error');
        return 'STRING';
      case 'DIV': case 'MOD':
        if (l && l !== 'INTEGER') this.err(`${e.op} requires INTEGER operands (found ${l})`, e.left.start, 'error');
        if (r && r !== 'INTEGER') this.err(`${e.op} requires INTEGER operands (found ${r})`, e.right.start, 'error');
        return 'INTEGER';
      case '/':
        return 'REAL';
      default: // + - *
        if ((l === 'STRING' || r === 'STRING') && e.op === '+') {
          this.err("Use '&' to join strings, not '+'", e.start, 'error');
          return 'STRING';
        }
        if (l === 'STRING' || r === 'STRING') return 'STRING';
        return l === 'REAL' || r === 'REAL' ? 'REAL' : 'INTEGER';
    }
  }

  private analyzeCall(e: CallExpr, ctx: Ctx): string {
    if (e.callee.kind === 'IdentifierExpr') {
      const name = e.callee.name;
      if (e.isNew) {
        // NEW ClassName(…) — object construction (section 10.2).
        const sym = ctx.scope.resolve(name);
        if (!sym || sym.kind !== 'class') this.err(`NEW requires a class name (${name} is not a class)`, e.callee.namePos, 'error');
        if (sym) this.bindName(e.callee.namePos, sym);
        for (const a of e.args) this.analyzeExpr(a, ctx);
        return sym?.kind === 'class' ? sym.name : '';
      }
      const builtin = BUILTIN_FUNCTIONS[name];
      if (builtin) {
        if (e.args.length !== builtin.params.length) {
          this.err(`'${name}' expects ${builtin.params.length} argument(s) but got ${e.args.length}`, e.callee.namePos, 'error');
        }
        for (let i = 0; i < e.args.length; i++) {
          const pt = builtin.params[i]?.type ?? null;
          this.analyzeExpr(e.args[i], ctx);
          this.checkLiteralArg(pt, e.args[i]);
        }
        return builtin.returns ?? '';
      }
      const sym = ctx.scope.resolve(name);
      if (!sym) {
        this.err(`Unknown function '${name}'`, e.callee.namePos, 'error');
        for (const a of e.args) this.analyzeExpr(a, ctx);
        return '';
      }
      if (sym.kind !== 'function') {
        this.err(`'${name}' is not a function`, e.callee.namePos, sym.kind === 'procedure' ? 'warning' : 'error');
        if (sym.kind === 'procedure') this.err(`Call procedures with CALL ${name}(…)`, e.callee.namePos, 'hint');
        for (const a of e.args) this.analyzeExpr(a, ctx);
        return '';
      }
      this.bindName(e.callee.namePos, sym);
      this.checkArity(sym, e.callee.namePos, e.args, ctx);
      for (const a of e.args) this.analyzeExpr(a, ctx);
      return sym.typeText;
    }
    // Method call:  object.Method(…)
    const member = this.resolveMember(e.callee, ctx);
    for (const a of e.args) this.analyzeExpr(a, ctx);
    if (member && (member.kind === 'procedure' || member.kind === 'function')) {
      this.checkArity(member, e.callee.memberPos, e.args, ctx);
      return member.kind === 'function' ? member.typeText : '';
    }
    if (member && member.kind !== 'procedure' && member.kind !== 'function') {
      this.err(`'${e.callee.member}' is not a method and cannot be called`, e.callee.memberPos, 'error');
    }
    return '';
  }

  private checkLiteralArg(pt: string | null, a: Expression): void {
    if (!pt || a.kind !== 'LiteralExpr') return;
    const got = LITERAL_TYPES[a.literalKind];
    if (!got) return;
    if (got === pt) return;
    if (got === 'INTEGER' && pt === 'REAL') return;
    if (got === 'CHAR' && pt === 'STRING') return;
    this.err(`Argument should be of type ${pt} (found a ${got} literal)`, a.start, 'error');
  }

  private checkArity(sym: SymbolInfo, at: Pos, args: Expression[], ctx: Ctx): void {
    const node = sym.declNode;
    if (!node || (node.kind !== 'ProcedureDecl' && node.kind !== 'FunctionDecl')) return;
    const params = node.params;
    if (params.length !== args.length) {
      this.err(`'${sym.name}' expects ${params.length} argument(s) but got ${args.length}`, at, 'error');
    }
    args.forEach((a, i) => {
      const p = params[i];
      if (p?.type) this.checkLiteralArg(typeNameOf(p.type), a);
    });
    void ctx;
  }

  private typeOfExpr(e: Expression, ctx: Ctx): string {
    if (e.kind === 'IdentifierExpr') {
      const sym = ctx.scope.resolve(e.name);
      return sym ? this.typeOfSymbol(sym) : '';
    }
    if (e.kind === 'IndexExpr') {
      const s = this.baseSymbol(e.base, ctx);
      if (!s) return '';
      const elem = this.arrayElement(s);
      return elem ? typeNameOf(elem) : '';
    }
    if (e.kind === 'CallExpr' && e.isNew && e.callee.kind === 'IdentifierExpr') {
      const sym = ctx.scope.resolve(e.callee.name);
      return sym?.kind === 'class' ? sym.name : '';
    }
    return '';
  }

  // ------------------------------------------------------------------- misc

  private bindName(at: Pos, sym: SymbolInfo): void {
    this.model.nameResolutions.set(`${at.line}:${at.char}`, sym);
  }

  private err(message: string, at: Pos, severity: IssueSeverity = 'error'): void {
    this.issues.push({ message, range: { start: at, end: { line: at.line, char: at.char + 1 } }, severity });
  }
}

export { Token };