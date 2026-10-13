/**
 * ast.ts — node definitions for the Cambridge 9618 pseudocode AST.
 * Pure data + small helpers; no behaviour lives here (SRP).
 */

export interface Pos {
  /** 0-based line. */
  line: number;
  /** 0-based character column. */
  char: number;
}

export interface Range {
  start: Pos;
  end: Pos;
}

export const pos = (line: number, char: number): Pos => ({ line, char });

export interface NodeBase {
  start: Pos;
  end: Pos;
}

// ---------------------------------------------------------------- declarations

export type AccessModifier = 'public' | 'private' | null;

export interface TypeRef extends NodeBase {
  kind: 'TypeRef';
  name: string;
}

export interface ArrayType extends NodeBase {
  kind: 'ArrayType';
  /** Bounds grouped by dimension, e.g. [[1,30],[1,3]] for ARRAY[1:30,1:3] OF … */
  bounds: Array<{ low: Expression; high: Expression }>;
  element: TypeExpr;
}

export interface SetType extends NodeBase {
  kind: 'SetType';
  element: TypeExpr;
}

export interface PointerType extends NodeBase {
  kind: 'PointerType';
  target: TypeExpr;
}

export type TypeExpr = TypeRef | ArrayType | SetType | PointerType;

export interface Param extends NodeBase {
  kind: 'Param';
  name: string;
  namePos: Pos;
  type: TypeExpr | null;
  byRef: boolean;
}

export interface VarDecl extends NodeBase {
  kind: 'VarDecl';
  name: string;
  namePos: Pos;
  type: TypeExpr | null;
  access: AccessModifier;
  /** True for bare `PRIVATE Attempts : INTEGER`-style property declarations. */
  isProperty: boolean;
}

export interface ConstDecl extends NodeBase {
  kind: 'ConstDecl';
  name: string;
  namePos: Pos;
  value: Expression;
}

export interface EnumValue {
  name: string;
  namePos: Pos;
}

export interface TypeDecl extends NodeBase {
  kind: 'TypeDecl';
  name: string;
  namePos: Pos;
  /** 'enum' | 'pointer' | 'set' | 'record' (section 4.1). */
  form: 'enum' | 'pointer' | 'set' | 'record';
  enumValues?: EnumValue[];
  pointerTarget?: TypeExpr;
  setElement?: TypeExpr;
  recordFields?: VarDecl[];
}

export interface DefineStmt extends NodeBase {
  kind: 'DefineStmt';
  name: string;
  namePos: Pos;
  values: Expression[];
  typeName: string;
  typeNamePos: Pos;
}

export interface ProcedureDecl extends NodeBase {
  kind: 'ProcedureDecl';
  name: string;
  namePos: Pos;
  params: Param[];
  body: Array<Statement | Declaration>;
  access: AccessModifier;
}

export interface FunctionDecl extends NodeBase {
  kind: 'FunctionDecl';
  name: string;
  namePos: Pos;
  params: Param[];
  returns: TypeExpr | null;
  body: Array<Statement | Declaration>;
  access: AccessModifier;
}

export type ClassMember = VarDecl | ProcedureDecl | FunctionDecl | ConstDecl;

export interface ClassDecl extends NodeBase {
  kind: 'ClassDecl';
  name: string;
  namePos: Pos;
  inherits: string | null;
  inheritsPos: Pos | null;
  members: ClassMember[];
}

export interface Program extends NodeBase {
  kind: 'Program';
  statements: Array<Declaration | Statement>;
}

export type Declaration =
  | VarDecl
  | ConstDecl
  | TypeDecl
  | DefineStmt
  | ProcedureDecl
  | FunctionDecl
  | ClassDecl;

// ----------------------------------------------------------------- statements

export interface InputStmt extends NodeBase {
  kind: 'InputStmt';
  target: Expression;
}

export interface OutputStmt extends NodeBase {
  kind: 'OutputStmt';
  args: Expression[];
}

export interface CallStmt extends NodeBase {
  kind: 'CallStmt';
  name: string;
  namePos: Pos;
  args: Expression[];
}

export interface ReturnStmt extends NodeBase {
  kind: 'ReturnStmt';
  value: Expression | null;
}

export interface OpenFileStmt extends NodeBase {
  kind: 'OpenFileStmt';
  file: Expression;
  mode: string;
  modePos: Pos;
}

export interface ReadFileStmt extends NodeBase {
  kind: 'ReadFileStmt';
  file: Expression;
  target: Expression;
}

export interface WriteFileStmt extends NodeBase {
  kind: 'WriteFileStmt';
  file: Expression;
  data: Expression;
}

export interface CloseFileStmt extends NodeBase {
  kind: 'CloseFileStmt';
  file: Expression;
}

export interface SeekStmt extends NodeBase {
  kind: 'SeekStmt';
  file: Expression;
  address: Expression;
}

export interface GetRecordStmt extends NodeBase {
  kind: 'GetRecordStmt';
  file: Expression;
  target: Expression;
}

export interface PutRecordStmt extends NodeBase {
  kind: 'PutRecordStmt';
  file: Expression;
  target: Expression;
}

export interface IfStmt extends NodeBase {
  kind: 'IfStmt';
  condition: Expression;
  thenBody: Array<Statement | Declaration>;
  elseBody: Array<Statement | Declaration> | null;
}

export interface CaseBranch {
  /** Value (or range) for this branch — at least one entry. */
  values: Array<Expression | RangeExpr>;
  body: Array<Statement | Declaration>;
  range: Range;
}

export interface CaseStmt extends NodeBase {
  kind: 'CaseStmt';
  subject: Expression;
  branches: CaseBranch[];
  /** Body of the OTHERWISE clause, if present. */
  otherwise: Array<Statement | Declaration> | null;
}

export interface ForStmt extends NodeBase {
  kind: 'ForStmt';
  variable: string;
  variablePos: Pos;
  from: Expression;
  to: Expression;
  step: Expression | null;
  body: Array<Statement | Declaration>;
  /** Identifier given after NEXT, if any (for the NEXT <id> check). */
  nextVar: string | null;
  nextVarPos: Pos | null;
}

export interface RepeatStmt extends NodeBase {
  kind: 'RepeatStmt';
  body: Array<Statement | Declaration>;
  condition: Expression;
}

export interface WhileStmt extends NodeBase {
  kind: 'WhileStmt';
  condition: Expression;
  body: Array<Statement | Declaration>;
}

export interface AssignStmt extends NodeBase {
  kind: 'AssignStmt';
  target: Expression;
  value: Expression;
}

export interface ExprStmt extends NodeBase {
  kind: 'ExprStmt';
  expr: Expression;
}

export type Statement =
  | InputStmt
  | OutputStmt
  | CallStmt
  | ReturnStmt
  | OpenFileStmt
  | ReadFileStmt
  | WriteFileStmt
  | CloseFileStmt
  | SeekStmt
  | GetRecordStmt
  | PutRecordStmt
  | IfStmt
  | CaseStmt
  | ForStmt
  | RepeatStmt
  | WhileStmt
  | AssignStmt
  | ExprStmt;

// --------------------------------------------------------------- expressions

export type LiteralKind = 'integer' | 'real' | 'string' | 'char' | 'date' | 'boolean';

export interface LiteralExpr extends NodeBase {
  kind: 'LiteralExpr';
  literalKind: LiteralKind;
  text: string;
}

export interface IdentifierExpr extends NodeBase {
  kind: 'IdentifierExpr';
  name: string;
  namePos: Pos;
}

export interface BinaryExpr extends NodeBase {
  kind: 'BinaryExpr';
  op: string; // + - * / DIV MOD & = <> < > <= >= AND OR
  left: Expression;
  right: Expression;
}

export interface UnaryExpr extends NodeBase {
  kind: 'UnaryExpr';
  op: string; // NOT | -
  operand: Expression;
}

export interface CallExpr extends NodeBase {
  kind: 'CallExpr';
  callee: IdentifierExpr | MemberExpr;
  args: Expression[];
  /** True for `NEW ClassName(…)` construction expressions (section 10.2). */
  isNew: boolean;
}

export interface IndexExpr extends NodeBase {
  kind: 'IndexExpr';
  base: Expression;
  indices: Expression[];
}

export interface MemberExpr extends NodeBase {
  kind: 'MemberExpr';
  base: Expression;
  member: string;
  memberPos: Pos;
}

export interface DerefExpr extends NodeBase {
  kind: 'DerefExpr';
  base: Expression;
}

export interface RangeExpr extends NodeBase {
  kind: 'RangeExpr';
  from: Expression;
  to: Expression;
}

export type Expression =
  | LiteralExpr
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | CallExpr
  | IndexExpr
  | MemberExpr
  | DerefExpr;

/** Name and location of a declared symbol (shared by symbols and diagnostics). */
export interface DeclarationSite {
  name: string;
  namePos: Pos;
  declRange: Range;
}