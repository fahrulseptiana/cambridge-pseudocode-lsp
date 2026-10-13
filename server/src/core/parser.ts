/**
 * parser.ts — recursive-descent parser producing the AST defined in ast.ts.
 *
 * The grammar is line-oriented (statements end at the end of a line; blocks are
 * closed by keywords that appear at the start of a line, e.g. ENDIF / NEXT).
 * Newlines inside parentheses or brackets are treated as whitespace so that
 * wrapped signatures and array indices (as printed in the guide) parse cleanly.
 *
 * On malformed input the parser records a ParseIssue, recovers to the end of
 * the offending line and keeps going, so features like completion and folding
 * still work on imperfect files.
 */

import {
  AccessModifier,
  ArrayType,
  AssignStmt,
  CallExpr,
  CallStmt,
  CaseBranch,
  CaseStmt,
  ClassDecl,
  CloseFileStmt,
  ConstDecl,
  DefineStmt,
  DerefExpr,
  EnumValue,
  ExprStmt,
  Expression,
  ForStmt,
  FunctionDecl,
  GetRecordStmt,
  IdentifierExpr,
  IfStmt,
  IndexExpr,
  InputStmt,
  LiteralExpr,
  MemberExpr,
  OpenFileStmt,
  OutputStmt,
  Param,
  PointerType,
  Pos,
  ProcedureDecl,
  Program,
  PutRecordStmt,
  RangeExpr,
  ReadFileStmt,
  RepeatStmt,
  ReturnStmt,
  SeekStmt,
  SetType,
  Statement,
  TypeDecl,
  TypeExpr,
  TypeRef,
  VarDecl,
  WhileStmt,
  WriteFileStmt,
  pos,
} from './ast';
import { FILE_MODES } from './lexicon';
import { Token, TokenKind, scan } from './scanner';

export interface ParseIssue {
  message: string;
  pos: Pos;
  /** Optional end position (defaults to the token end). */
  end?: Pos;
  severity: 'error' | 'warning';
}

const PLACEHOLDER = '__missing__';

/** Names synthesised by the parser are skipped by the semantic analyser. */
export function isSyntheticName(name: string): boolean {
  return name.startsWith('__');
}

// ---------------------------------------------------------------------------

export interface ParseResult {
  program: Program;
  tokens: Token[];
  issues: ParseIssue[];
}

export function parse(source: string): ParseResult {
  const tokens = scan(source);
  const parser = new Parser(tokens);
  const program = parser.parseProgram();
  return { program, tokens, issues: parser.issues };
}

class Parser {
  readonly issues: ParseIssue[] = [];
  private readonly tokens: Token[];
  private i = 0;
  /** Depth of ( and [ brackets — newlines are insignificant above zero. */
  private bracketDepth = 0;
  private lastError = false;
  private lastToken: Token;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.lastToken = tokens[0];
  }

  // ------------------------------------------------------------ token helpers

  /**
   * Next *significant* token: comments are invisible everywhere; newlines are
   * insignificant inside brackets so wrapped array accesses / signatures work.
   */
  private peek(offset = 0): Token {
    let idx = this.i;
    let remaining = offset;
    for (;;) {
      const t = this.tokens[Math.min(idx, this.tokens.length - 1)];
      if (t.kind === TokenKind.Comment) { idx += 1; continue; }
      if (this.bracketDepth > 0 && t.kind === TokenKind.Newline) { idx += 1; continue; }
      if (remaining > 0) { remaining -= 1; idx += 1; continue; }
      return t;
    }
  }

  private atEnd(): boolean {
    return this.peek().kind === TokenKind.EndOfFile;
  }

  private advance(): Token {
    // Skip trivia on the raw stream (peek() skips transparently, so walk raw).
    let t = this.tokens[this.i];
    while (t.kind === TokenKind.Comment || (t.kind === TokenKind.Newline && this.bracketDepth > 0)) {
      this.i += 1;
      t = this.tokens[this.i];
    }
    if (t.kind === TokenKind.Operator) {
      if (t.value === '(' || t.value === '[') this.bracketDepth += 1;
      else if (t.value === ')' || t.value === ']') this.bracketDepth = Math.max(0, this.bracketDepth - 1);
    }
    this.lastToken = t;
    if (t.kind !== TokenKind.EndOfFile) this.i += 1;
    return t;
  }

  private isWord(w: string): boolean {
    const t = this.peek();
    return t.kind === TokenKind.Word && t.value === w;
  }

  private matchWord(w: string): Token | null {
    if (this.isWord(w)) return this.advance();
    return null;
  }

  private matchOperator(v: string): Token | null {
    const t = this.peek();
    if (t.kind === TokenKind.Operator && t.value === v) return this.advance();
    return null;
  }

  private isOperator(v: string): boolean {
    const t = this.peek();
    return t.kind === TokenKind.Operator && t.value === v;
  }

  private skipNewlines(): void {
    while (!this.atEnd() && (this.peek().kind === TokenKind.Newline)) this.advance();
  }

  /** Span of the last consumed token (used to close node ranges). */
  private span(startTok: Token): { start: Pos; end: Pos } {
    return {
      start: { line: startTok.line, char: startTok.char },
      end: { line: this.lastToken.line, char: this.lastToken.char + this.lastToken.length },
    };
  }
  private spanStart(): { start: Pos; end: Pos } {
    return this.span(this.peek());
  }

  private error(message: string, t: Token, severity: 'error' | 'warning' = 'error'): void {
    this.issues.push({
      message,
      pos: { line: t.line, char: t.char },
      end: { line: t.line, char: t.char + t.length },
      severity,
    });
    this.lastError = true;
  }

  /** Throw away the rest of the current logical line (also consumed the error token). */
  private recoverToLineEnd(): void {
    while (!this.atEnd() && this.peek().kind !== TokenKind.Newline) this.advance();
    this.lastError = false;
  }

  private expectWord(w: string, what = `'${w}'`): Token | null {
    const t = this.matchWord(w);
    if (!t) this.error(`Expected keyword ${what}`, this.peek());
    return t;
  }

  private expectOperator(v: string): Token | null {
    const t = this.matchOperator(v);
    if (!t) this.error(`Expected '${v}'`, this.peek());
    return t;
  }

  private expectArrow(): void {
    const t = this.peek();
    if (t.kind !== TokenKind.Arrow) {
      this.error('Expected the assignment operator "←"', t);
    } else {
      this.advance();
    }
  }

  /** Consume a valid identifier (a word that is not a structured keyword). */
  private expectName(what: string, allowKeyword = false): { name: string; tok: Token } {
    const t = this.peek();
    if (t.kind === TokenKind.Word && (allowKeyword || !this.isStructuredKeyword(t.value))) {
      this.advance();
      return { name: t.value, tok: t };
    }
    this.error(`Expected ${what}`, t);
    this.advance();
    const e = this.peek();
    return { name: PLACEHOLDER, tok: e };
  }

  /** Words that never make valid identifiers in our grammar (structural keywords). */
  private isStructuredKeyword(w: string): boolean {
    return [
      'DECLARE', 'CONSTANT', 'INPUT', 'OUTPUT', 'CALL', 'RETURN', 'IF', 'THEN', 'ELSE', 'ENDIF',
      'CASE', 'OF', 'OTHERWISE', 'ENDCASE', 'FOR', 'TO', 'STEP', 'NEXT', 'REPEAT', 'UNTIL',
      'WHILE', 'ENDWHILE', 'PROCEDURE', 'ENDPROCEDURE', 'FUNCTION', 'ENDFUNCTION', 'RETURNS',
      'CLASS', 'ENDCLASS', 'INHERITS', 'TYPE', 'ENDTYPE', 'DEFINE', 'OPENFILE', 'FOR',
    ].includes(w);
  }

  // ------------------------------------------------------------------ program

  parseProgram(): Program {
    const start = this.peek();
    const statements: Array<Statement | import('./ast').Declaration> = [];
    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) break;
      const st = this.parseStatement();
      statements.push(st);
    }
    const span = this.span(start);
    return { kind: 'Program', ...span, statements };
  }

  /** Parse a single statement (declarations are statements at the top level). */
  private parseStatement(): Statement | import('./ast').Declaration {
    const startTok = this.peek();
    const t = this.peek();
    this.lastError = false;

    let node: Statement | import('./ast').Declaration | null = null;

    if (t.kind === TokenKind.Word) {
      const w = t.value;
      if ((w === 'PUBLIC' || w === 'PRIVATE') && !this.isFollowedByAccessTarget(w)) node = null;
      switch (w) {
        case 'PUBLIC':
        case 'PRIVATE':
          node = this.parseAccessDecl(w === 'PRIVATE' ? 'private' : 'public');
          break;
        case 'DECLARE':
          node = this.parseVarDecl(null, false);
          break;
        case 'CONSTANT':
          node = this.parseConstDecl();
          break;
        case 'INPUT':
          node = this.parseInput();
          break;
        case 'OUTPUT':
          node = this.parseOutput();
          break;
        case 'CALL':
          node = this.parseCall();
          break;
        case 'RETURN':
          node = this.parseReturn();
          break;
        case 'OPENFILE':
          node = this.parseOpenFile();
          break;
        case 'READFILE':
          node = this.parseFileOp('ReadFileStmt');
          break;
        case 'WRITEFILE':
          node = this.parseFileOp('WriteFileStmt');
          break;
        case 'CLOSEFILE':
          node = this.parseCloseFile();
          break;
        case 'SEEK':
          node = this.parseSeek();
          break;
        case 'GETRECORD':
          node = this.parseFileOp('GetRecordStmt');
          break;
        case 'PUTRECORD':
          node = this.parseFileOp('PutRecordStmt');
          break;
        case 'IF':
          node = this.parseIf();
          break;
        case 'CASE':
          node = this.parseCase();
          break;
        case 'FOR':
          node = this.parseFor();
          break;
        case 'REPEAT':
          node = this.parseRepeat();
          break;
        case 'WHILE':
          node = this.parseWhile();
          break;
        case 'PROCEDURE':
          node = this.parseProcedure(null);
          break;
        case 'FUNCTION':
          node = this.parseFunction(null);
          break;
        case 'CLASS':
          node = this.parseClass();
          break;
        case 'TYPE':
          node = this.parseType();
          break;
        case 'DEFINE':
          node = this.parseDefine();
          break;
        default:
          node = this.parseExprStatement();
      }
      if (node && this.lastError) this.recoverToLineEnd();
      if (node) return node;
    }

    // Anything else is treated as an expression statement (so method calls
    // such as Player.SetAttempts(5) are statements too).
    node = this.parseExprStatement();
    if (this.lastError) this.recoverToLineEnd();
    return node ?? this.placeholderExprStmt(startTok);
  }

  /** Guard: `PUBLIC`/`PRIVATE` must be followed by DECLARE / PROCEDURE / FUNCTION / a property. */
  private isFollowedByAccessTarget(_w: string): boolean {
    const n = this.peek(1);
    return n.kind === TokenKind.Word && ['DECLARE', 'PROCEDURE', 'FUNCTION'].includes(n.value);
  }

  private parseAccessDecl(access: AccessModifier): Statement | import('./ast').Declaration {
    const start = this.advance(); // PUBLIC | PRIVATE
    const t = this.peek();
    if (t.kind === TokenKind.Word && t.value === 'DECLARE') {
      const node = this.parseVarDecl(access, false);
      node.start = { line: start.line, char: start.char };
      return node;
    }
    if (t.kind === TokenKind.Word && t.value === 'PROCEDURE') {
      const node = this.parseProcedure(access);
      node.start = { line: start.line, char: start.char };
      return node;
    }
    if (t.kind === TokenKind.Word && t.value === 'FUNCTION') {
      const node = this.parseFunction(access);
      node.start = { line: start.line, char: start.char };
      return node;
    }
    // Property declaration:  PRIVATE Name : STRING
    const name = this.expectName('an identifier (property name)');
    this.expectOperator(':');
    const type = this.parseTypeExpr();
    return {
      kind: 'VarDecl',
      ...this.span(start),
      name: name.name,
      namePos: { line: name.tok.line, char: name.tok.char },
      type,
      access,
      isProperty: true,
    };
  }

  // ------------------------------------------------------------- declarations

  private parseVarDecl(access: AccessModifier, isProperty: boolean): VarDecl {
    const start = this.advance(); // DECLARE
    const name = this.expectName('an identifier');
    this.expectOperator(':');
    const type = this.parseTypeExpr();
    return {
      kind: 'VarDecl',
      ...this.span(start),
      name: name.name,
      namePos: { line: name.tok.line, char: name.tok.char },
      type,
      access,
      isProperty,
    };
  }

  private parseConstDecl(): ConstDecl {
    const start = this.advance(); // CONSTANT
    const name = this.expectName('an identifier');
    const eq = this.matchOperator('=');
    if (!eq) this.error("Expected '='", this.peek());
    const value = this.parseExpr();
    return { kind: 'ConstDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, value };
  }

  private parseType(): TypeDecl | null {
    const start = this.advance(); // TYPE
    const name = this.expectName('an identifier');
    const rest = this.span(start);

    if (this.matchOperator('=')) {
      const t = this.peek();
      if (t.kind === TokenKind.Operator && t.value === '(') {
        // Enumerated:  TYPE Season = (Spring, Summer, Autumn, Winter)
        this.advance();
        const enumValues: EnumValue[] = [];
        while (!this.atEnd() && !this.isOperator(')')) {
          const v = this.expectName('an enumerated value');
          enumValues.push({ name: v.name, namePos: { line: v.tok.line, char: v.tok.char } });
          if (!this.matchOperator(',')) break;
        }
        this.expectOperator(')');
        return { kind: 'TypeDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, form: 'enum', enumValues };
      }
      if (t.kind === TokenKind.Operator && t.value === '^') {
        // Pointer:  TYPE TIntPointer = ^INTEGER
        const pointerTarget = this.parseTypeExpr();
        return { kind: 'TypeDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, form: 'pointer', pointerTarget };
      }
      if (t.kind === TokenKind.Word && t.value === 'SET') {
        // Set:  TYPE LetterSet = SET OF CHAR
        this.advance();
        this.expectWord('OF', "'OF' (SET OF <type>)");
        const setElement = this.parseTypeExpr();
        return { kind: 'TypeDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, form: 'set', setElement };
      }
      this.error("Expected '(' (enumerated), '^' (pointer) or SET OF after '='", t);
      this.recoverToLineEnd();
      return this.placeholderType(start, rest);
    }

    // Record:  TYPE StudentRecord  …  ENDTYPE
    const recordFields: VarDecl[] = [];
    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) {
        this.error("Expected 'ENDTYPE' at the end of the record", this.lastToken);
        break;
      }
      if (this.isWord('ENDTYPE')) {
        this.advance();
        break;
      }
      const f = this.parseRecordField();
      if (f) recordFields.push(f);
    }
    return { kind: 'TypeDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, form: 'record', recordFields };
  }

  private placeholderType(start: Token, rest: { start: Pos; end: Pos }): TypeDecl {
    return { kind: 'TypeDecl', ...rest, name: PLACEHOLDER, namePos: { line: start.line, char: start.char }, form: 'enum' };
  }

  private parseRecordField(): VarDecl | null {
    const start = this.peek();
    let access: AccessModifier = null;
    if (this.isWord('PUBLIC') || this.isWord('PRIVATE')) {
      access = this.isWord('PRIVATE') ? 'private' : 'public';
      this.advance();
    }
    this.matchWord('DECLARE');
    const name = this.expectName('a field name');
    if (!this.matchOperator(':')) this.error("Expected ':'", this.peek());
    const type = this.parseTypeExpr();
    return { kind: 'VarDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, type, access, isProperty: true };
  }

  private parseDefine(): DefineStmt {
    const start = this.advance(); // DEFINE
    const name = this.expectName('an identifier');
    this.expectOperator('(');
    const values: Expression[] = [];
    while (!this.atEnd() && !this.isOperator(')')) {
      values.push(this.parsePrimary());
      if (!this.matchOperator(',')) break;
    }
    this.expectOperator(')');
    this.expectOperator(':');
    const tn = this.expectName('a type name');
    return {
      kind: 'DefineStmt',
      ...this.span(start),
      name: name.name,
      namePos: { line: name.tok.line, char: name.tok.char },
      values,
      typeName: tn.name,
      typeNamePos: { line: tn.tok.line, char: tn.tok.char },
    };
  }

  private parseParamList(): Param[] {
    const params: Param[] = [];
    this.expectOperator('(');
    while (!this.atEnd() && !this.isOperator(')')) {
      const start = this.peek();
      let byRef = false;
      if (this.isWord('BYREF') || this.isWord('BYVAL')) {
        byRef = this.isWord('BYREF');
        this.advance();
      }
      const name = this.expectName('a parameter name');
      this.expectOperator(':');
      const type = this.parseTypeExpr();
      params.push({
        kind: 'Param',
        ...this.span(start),
        name: name.name,
        namePos: { line: name.tok.line, char: name.tok.char },
        type,
        byRef,
      });
      if (!this.matchOperator(',')) break;
    }
    this.expectOperator(')');
    return params;
  }

  private parseProcedure(access: AccessModifier): ProcedureDecl {
    const start = this.advance(); // PROCEDURE
    const name = this.expectName('a procedure name');
    const params = this.parseParamList();
    const body = this.parseBlockBody(['ENDPROCEDURE']);
    this.expectWord('ENDPROCEDURE');
    return { kind: 'ProcedureDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, params, body, access };
  }

  private parseFunction(access: AccessModifier): FunctionDecl {
    const start = this.advance(); // FUNCTION
    const name = this.expectName('a function name');
    const params = this.parseParamList();
    this.expectWord('RETURNS', "'RETURNS'");
    const returns = this.parseTypeExpr();
    const body = this.parseBlockBody(['ENDFUNCTION']);
    this.expectWord('ENDFUNCTION');
    return { kind: 'FunctionDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, params, returns, body, access };
  }

  private parseClass(): ClassDecl {
    const start = this.advance(); // CLASS
    const name = this.expectName('a class name');
    let inherits: string | null = null;
    let inheritsPos: Pos | null = null;
    if (this.matchWord('INHERITS')) {
      const s = this.expectName('a superclass name');
      inherits = s.name;
      inheritsPos = { line: s.tok.line, char: s.tok.char };
    }
    const members: ClassDecl['members'] = [];
    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) {
        this.error("Expected 'ENDCLASS' at the end of the class", this.lastToken);
        break;
      }
      if (this.isWord('ENDCLASS')) {
        this.advance();
        break;
      }
      // Class members are statements (PUBLIC/PRIVATE PROPERTY/PROCEDURE/FUNCTION/DECLARE/CONSTANT).
      const isMemberStart = this.isWord('PUBLIC') || this.isWord('PRIVATE') || this.isWord('DECLARE') ||
        this.isWord('PROCEDURE') || this.isWord('FUNCTION') || this.isWord('CONSTANT');
      if (!isMemberStart && this.peek().kind === TokenKind.Word) {
        // Bare `Attempts : INTEGER` inside a class — treat as property declaration.
        const f = this.parseRecordField();
        if (f) members.push(f);
        continue;
      }
      const st = this.parseStatement();
      if (this.isMember(st)) members.push(st);
    }
    return { kind: 'ClassDecl', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, inherits, inheritsPos, members };
  }

  private isMember(n: Statement | import('./ast').Declaration): n is ClassDecl['members'][number] {
    return n.kind === 'VarDecl' || n.kind === 'ConstDecl' || n.kind === 'ProcedureDecl' || n.kind === 'FunctionDecl';
  }

  // --------------------------------------------------------------- statements

  private parseInput(): InputStmt {
    const start = this.advance(); // INPUT
    const target = this.parseExpr();
    return { kind: 'InputStmt', ...this.span(start), target };
  }

  private parseOutput(): OutputStmt {
    const start = this.advance(); // OUTPUT
    const args: Expression[] = [];
    args.push(this.parseExpr());
    while (this.matchOperator(',')) {
      args.push(this.parseExpr());
    }
    return { kind: 'OutputStmt', ...this.span(start), args };
  }

  private parseCall(): CallStmt {
    const start = this.advance(); // CALL
    const name = this.expectName('a procedure name');
    this.expectOperator('(');
    const args: Expression[] = [];
    while (!this.atEnd() && !this.isOperator(')')) {
      args.push(this.parseExpr());
      if (!this.matchOperator(',')) break;
    }
    this.expectOperator(')');
    return { kind: 'CallStmt', ...this.span(start), name: name.name, namePos: { line: name.tok.line, char: name.tok.char }, args };
  }

  private parseReturn(): ReturnStmt {
    const start = this.advance(); // RETURN
    const t = this.peek();
    const value = t.kind === TokenKind.Newline || t.kind === TokenKind.EndOfFile ? null : this.parseExpr();
    return { kind: 'ReturnStmt', ...this.span(start), value };
  }

  private parseOpenFile(): OpenFileStmt {
    const start = this.advance(); // OPENFILE
    const file = this.parseExpr();
    this.expectWord('FOR', "'FOR'");
    const mode = this.parseFileMode();
    return { kind: 'OpenFileStmt', ...this.span(start), file, mode: mode.value, modePos: { line: mode.line, char: mode.char } };
  }

  private parseFileMode(): Token {
    const t = this.peek();
    if (t.kind === TokenKind.Word && FILE_MODES.includes(t.value as (typeof FILE_MODES)[number])) {
      this.advance();
      return t;
    }
    this.error('Expected a file mode: READ, WRITE, APPEND or RANDOM', t);
    this.advance();
    return t;
  }

  private parseCloseFile(): CloseFileStmt {
    const start = this.advance(); // CLOSEFILE
    const file = this.parseExpr();
    return { kind: 'CloseFileStmt', ...this.span(start), file };
  }

  private parseSeek(): SeekStmt {
    const start = this.advance(); // SEEK
    const file = this.parseExpr();
    this.expectOperator(',');
    const address = this.parseExpr();
    return { kind: 'SeekStmt', ...this.span(start), file, address };
  }

  private parseFileOp(kind: 'ReadFileStmt' | 'WriteFileStmt' | 'GetRecordStmt' | 'PutRecordStmt'): Statement {
    const start = this.advance();
    const file = this.parseExpr();
    this.expectOperator(',');
    const target = this.parseExpr();
    const span = this.span(start);
    switch (kind) {
      case 'ReadFileStmt': return { kind, ...span, file, target };
      case 'WriteFileStmt': return { kind, ...span, file, data: target };
      case 'GetRecordStmt': return { kind, ...span, file, target };
      case 'PutRecordStmt': return { kind, ...span, file, target };
    }
  }

  private parseExprStatement(): ExprStmt | AssignStmt | null {
    const start = this.peek();
    const expr = this.parseExpr();

    if (this.peek().kind === TokenKind.Arrow) {
      this.advance();
      const value = this.parseExpr();
      return { kind: 'AssignStmt', ...this.span(start), target: expr, value };
    }
    if (expr.kind === 'CallExpr') {
      // A bare call expression as a statement: e.g. an object method call.
      return { kind: 'ExprStmt', ...this.span(start), expr };
    }
    if (expr.kind === 'IdentifierExpr' && this.lastError) {
      return null;
    }
    if (expr.kind === 'IdentifierExpr' && expr.name === PLACEHOLDER) return null;
    this.error('Expected the assignment operator "←" (or a procedure/method call)', this.peek(), 'error');
    return { kind: 'ExprStmt', ...this.span(start), expr };
  }

  // ------------------------------------------------------------- block bodies

  /**
   * Parse statements until a terminator keyword (e.g. ENDIF) appears at the
   * start of a line. The terminator is NOT consumed.
   */
  private parseBlockBody(terminators: string[]): Array<Statement | import('./ast').Declaration> {
    const body: Array<Statement | import('./ast').Declaration> = [];
    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) {
        this.error(`Expected ${terminators.join(' or ')} to close the block`, this.lastToken);
        break;
      }
      const t = this.peek();
      if (t.kind === TokenKind.Word && terminators.includes(t.value)) break;
      const st = this.parseStatement();
      if (st) body.push(st);
    }
    return body;
  }

  private parseIf(): IfStmt {
    const start = this.advance(); // IF
    const cond = this.parseExpr();
    this.expectWord('THEN', "'THEN'");
    const thenBody = this.parseBlockBody(['ELSE', 'ENDIF']);
    let elseBody: Array<Statement | import('./ast').Declaration> | null = null;
    if (this.matchWord('ELSE')) {
      elseBody = this.parseBlockBody(['ENDIF']);
    }
    this.expectWord('ENDIF');
    return { kind: 'IfStmt', ...this.span(start), condition: cond, thenBody, elseBody };
  }

  private parseCase(): CaseStmt {
    const start = this.advance(); // CASE
    this.expectWord('OF', "'OF'");
    const subject = this.parseExpr();

    const branches: CaseBranch[] = [];
    let otherwise: Array<Statement | import('./ast').Declaration> | null = null;
    let current: Array<Statement | import('./ast').Declaration> = [];

    while (!this.atEnd()) {
      this.skipNewlines();
      if (this.atEnd()) {
        this.error("Expected 'ENDCASE'", this.lastToken);
        break;
      }
      if (this.isWord('ENDCASE')) {
        this.advance();
        break;
      }
      const header = this.tryParseCaseHeader();
      if (header) {
        if (header.otherwise) {
          otherwise = [];
          current = otherwise;
        } else {
          branches.push({ values: header.values, body: [], range: this.span(start) });
          current = branches[branches.length - 1].body;
        }
        continue;
      }
      if (current.length === 0 && branches.length === 0 && otherwise === null) {
        this.error('Statement must be inside a CASE branch or OTHERWISE clause', this.peek(), 'warning');
      }
      const st = this.parseStatement();
      if (st) current.push(st);
    }
    return { kind: 'CaseStmt', ...this.span(start), subject, branches, otherwise };
  }

  private tryParseCaseHeader(): { values: Array<Expression | RangeExpr>; otherwise: boolean } | null {
    const save = this.i;
    const t0 = this.peek();
    if (!this.isCaseValue(this.peek())) return null;

    const t1 = this.peek(1);
    if (t0.kind === TokenKind.Word && t0.value === 'OTHERWISE' && t1.kind === TokenKind.Operator && t1.value === ':') {
      this.advance(); // OTHERWISE
      this.advance(); // ':'
      return { values: [], otherwise: true };
    }
    if (t1.kind === TokenKind.Operator && t1.value === ':') {
      const value = this.parseCaseValue();
      this.advance(); // ':'
      return { values: [value], otherwise: false };
    }
    const t2 = this.peek(2);
    const t3 = this.peek(3);
    if (t1.kind === TokenKind.Word && t1.value === 'TO' && this.isCaseValue(t2) && t3.kind === TokenKind.Operator && t3.value === ':') {
      const from = this.parseCaseValue();
      this.advance(); // TO
      const to = this.parseCaseValue();
      this.advance(); // ':'
      const span = this.span(t0);
      return { values: [{ kind: 'RangeExpr', ...span, from, to }], otherwise: false };
    }
    this.i = save;
    return null;
  }

  private isCaseValue(t: Token): boolean {
    return (
      t.kind === TokenKind.Word ||
      t.kind === TokenKind.Integer ||
      t.kind === TokenKind.Real ||
      t.kind === TokenKind.CharLiteral ||
      t.kind === TokenKind.StringLiteral ||
      t.kind === TokenKind.DateLiteral
    );
  }

  private parseCaseValue(): Expression {
    const t = this.advance();
    return this.literalFromToken(t);
  }

  private parseFor(): ForStmt {
    const start = this.advance(); // FOR
    const v = this.expectName('a loop variable');
    this.expectArrow();
    const from = this.parseExpr();
    this.expectWord('TO', "'TO'");
    const to = this.parseExpr();
    let step: Expression | null = null;
    if (this.matchWord('STEP')) {
      step = this.parseExpr();
    }
    const body = this.parseBlockBody(['NEXT']);
    this.expectWord('NEXT');
    let nextVar: string | null = null;
    let nextVarPos: Pos | null = null;
    const n = this.peek();
    if (n.kind === TokenKind.Word && !this.isStructuredKeyword(n.value)) {
      this.advance();
      nextVar = n.value;
      nextVarPos = { line: n.line, char: n.char };
    }
    return {
      kind: 'ForStmt',
      ...this.span(start),
      variable: v.name,
      variablePos: { line: v.tok.line, char: v.tok.char },
      from, to, step, body, nextVar, nextVarPos,
    };
  }

  private parseRepeat(): RepeatStmt {
    const start = this.advance(); // REPEAT
    const body = this.parseBlockBody(['UNTIL']);
    this.expectWord('UNTIL');
    const condition = this.parseExpr();
    return { kind: 'RepeatStmt', ...this.span(start), body, condition };
  }

  private parseWhile(): WhileStmt {
    const start = this.advance(); // WHILE
    const condition = this.parseExpr();
    const body = this.parseBlockBody(['ENDWHILE']);
    this.expectWord('ENDWHILE');
    return { kind: 'WhileStmt', ...this.span(start), condition, body };
  }

  // --------------------------------------------------------------- expressions

  private parseExpr(): Expression {
    return this.parseOr();
  }

  private parseOr(): Expression {
    let left = this.parseAnd();
    while (this.isWord('OR')) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op: op.value, left, right };
    }
    return left;
  }

  private parseAnd(): Expression {
    let left = this.parseNot();
    while (this.isWord('AND')) {
      const op = this.advance();
      const right = this.parseNot();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op: op.value, left, right };
    }
    return left;
  }

  private parseNot(): Expression {
    if (this.isWord('NOT')) {
      const op = this.advance();
      const operand = this.parseNot();
      return { kind: 'UnaryExpr', ...this.span(op), op: op.value, operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): Expression {
    let left = this.parseConcat();
    for (;;) {
      const t = this.peek();
      const op = t.kind === TokenKind.Operator ? t.value : '';
      if (!['=', '<>', '<', '>', '<=', '>='].includes(op)) break;
      this.advance();
      const right = this.parseConcat();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op, left, right };
    }
    return left;
  }

  private parseConcat(): Expression {
    let left = this.parseAdditive();
    while (this.isOperator('&')) {
      this.advance();
      const right = this.parseAdditive();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op: '&', left, right };
    }
    return left;
  }

  private parseAdditive(): Expression {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.kind !== TokenKind.Operator || (t.value !== '+' && t.value !== '-')) break;
      this.advance();
      const right = this.parseMultiplicative();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op: t.value, left, right };
    }
    return left;
  }

  private parseMultiplicative(): Expression {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      let op: string | null = null;
      if (t.kind === TokenKind.Operator && (t.value === '*' || t.value === '/')) op = t.value;
      else if (t.kind === TokenKind.Word && (t.value === 'DIV' || t.value === 'MOD')) op = t.value;
      if (!op) break;
      this.advance();
      const right = this.parseUnary();
      left = { kind: 'BinaryExpr', ...this.span(this.tokOf(left)), op, left, right };
    }
    return left;
  }

  private parseUnary(): Expression {
    const t = this.peek();
    if (t.kind === TokenKind.Operator && (t.value === '-' || t.value === '^')) {
      // '-' = negation; '^' = address-of (guide §4.2: MyPointer ← ^ThisSeason)
      this.advance();
      const operand = this.parseUnary();
      return { kind: 'UnaryExpr', ...this.span(t), op: t.value, operand };
    }
    if (t.kind === TokenKind.Operator && t.value === '+') {
      this.advance();
      return this.parseUnary();
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expression {
    let expr = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.kind === TokenKind.Operator && t.value === '[') {
        this.advance();
        const indices: Expression[] = [this.parseExpr()];
        while (this.matchOperator(',')) indices.push(this.parseExpr());
        this.expectOperator(']');
        expr = { kind: 'IndexExpr', ...this.span(this.tokOf(expr)), base: expr, indices };
        continue;
      }
      if (t.kind === TokenKind.Operator && t.value === '.') {
        this.advance();
        const m = this.expectName('a member name', true);
        expr = { kind: 'MemberExpr', ...this.span(this.tokOf(expr)), base: expr, member: m.name, memberPos: { line: m.tok.line, char: m.tok.char } };
        continue;
      }
      if (t.kind === TokenKind.Operator && t.value === '^') {
        this.advance();
        expr = { kind: 'DerefExpr', ...this.span(this.tokOf(expr)), base: expr };
        continue;
      }
      if (t.kind === TokenKind.Operator && t.value === '(') {
        const e = expr;
        if (e.kind !== 'IdentifierExpr' && e.kind !== 'MemberExpr') {
          this.error('Only functions/methods may be called', t);
          this.recoverToLineEnd();
          return expr;
        }
        this.advance();
        const args: Expression[] = [];
        while (!this.atEnd() && !this.isOperator(')')) {
          args.push(this.parseExpr());
          if (!this.matchOperator(',')) break;
        }
        this.expectOperator(')');
        expr = { kind: 'CallExpr', ...this.span(this.tokOf(e)), callee: e, args, isNew: false };
        continue;
      }
      break;
    }
    return expr;
  }

  private parsePrimary(): Expression {
    const t = this.peek();
    switch (t.kind) {
      case TokenKind.Integer:
      case TokenKind.Real:
      case TokenKind.DateLiteral:
      case TokenKind.StringLiteral:
      case TokenKind.CharLiteral:
        this.advance();
        return this.literalFromToken(t);
      case TokenKind.Word: {
        if (t.value === 'TRUE' || t.value === 'FALSE') {
          this.advance();
          return { kind: 'LiteralExpr', ...this.span(t), literalKind: 'boolean', text: t.value };
        }
        if (t.value === 'NEW') {
          // Construction:  NEW ClassName(…)
          this.advance();
          const name = this.expectName('a class name');
          const callee: IdentifierExpr = { kind: 'IdentifierExpr', ...this.span(t), name: name.name, namePos: { line: name.tok.line, char: name.tok.char } };
          this.expectOperator('(');
          const args: Expression[] = [];
          while (!this.atEnd() && !this.isOperator(')')) {
            args.push(this.parseExpr());
            if (!this.matchOperator(',')) break;
          }
          this.expectOperator(')');
          return { kind: 'CallExpr', ...this.span(t), callee, args, isNew: true };
        }
        this.advance();
        return { kind: 'IdentifierExpr', ...this.span(t), name: t.value, namePos: { line: t.line, char: t.char } };
      }
      case TokenKind.Operator:
        if (t.value === '(') {
          this.advance();
          const inner = this.parseExpr();
          this.expectOperator(')');
          return inner;
        }
        this.error(`Unexpected token '${t.value}' in expression`, t);
        this.advance();
        return this.syntheticLiteral(t);
      case TokenKind.Error:
        this.advance();
        return this.syntheticLiteral(t);
      default:
        this.error('Expected an expression', t);
        if (t.kind === TokenKind.EndOfFile) return this.syntheticLiteral(t);
        return this.syntheticLiteral(t);
    }
  }

  private syntheticLiteral(t: Token): LiteralExpr {
    return { kind: 'LiteralExpr', ...this.span(t), literalKind: 'integer', text: '0' };
  }

  private literalFromToken(t: Token): LiteralExpr {
    let literalKind: LiteralExpr['literalKind'];
    switch (t.kind) {
      case TokenKind.Real: literalKind = 'real'; break;
      case TokenKind.StringLiteral: literalKind = 'string'; break;
      case TokenKind.CharLiteral: literalKind = 'char'; break;
      case TokenKind.DateLiteral: literalKind = 'date'; break;
      default: literalKind = 'integer';
    }
    return { kind: 'LiteralExpr', ...this.span(t), literalKind, text: t.value };
  }

  /** Find the token for an expression (its start position) to compute spans. */
  private tokOf(e: Expression): Token {
    for (const t of this.tokens) {
      if (t.line === e.start.line && t.char === e.start.char) return t;
    }
    return this.lastToken;
  }

  private placeholderExprStmt(start: Token): ExprStmt {
    return {
      kind: 'ExprStmt',
      ...this.span(start),
      expr: this.syntheticLiteral(start),
    };
  }

  // ------------------------------------------------------------- type exprs

  private parseTypeExpr(): TypeExpr {
    const t = this.peek();
    if (t.kind === TokenKind.Operator && t.value === '^') {
      this.advance();
      const target = this.parseTypeExpr();
      return { kind: 'PointerType', ...this.span(t), target };
    }
    if (t.kind === TokenKind.Word) {
      if (t.value === 'ARRAY') {
        const start = this.advance();
        this.expectOperator('[');
        const bounds: ArrayType['bounds'] = [];
        for (;;) {
          const low = this.parseExpr();
          this.expectOperator(':');
          const high = this.parseExpr();
          bounds.push({ low, high });
          if (!this.matchOperator(',')) break;
        }
        this.expectOperator(']');
        this.expectWord('OF', "'OF'");
        const element = this.parseTypeExpr();
        return { kind: 'ArrayType', ...this.span(start), bounds, element };
      }
      if (t.value === 'SET') {
        const start = this.advance();
        this.expectWord('OF', "'OF' (SET OF <type>)");
        const element = this.parseTypeExpr();
        return { kind: 'SetType', ...this.span(start), element };
      }
      this.advance();
      return { kind: 'TypeRef', ...this.span(t), name: t.value };
    }
    this.error('Expected a data type', t);
    this.advance();
    return { kind: 'TypeRef', ...this.span(t), name: PLACEHOLDER };
  }
}