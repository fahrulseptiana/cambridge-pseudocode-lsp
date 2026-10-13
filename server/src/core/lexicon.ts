/**
 * lexicon.ts — the single source of truth for the Cambridge 9618 pseudocode
 * vocabulary (DRY: scanner, parser checks, completion, hover docs and
 * semantic highlighting all derive from this module; nothing hard-codes a
 * keyword list anywhere else).
 *
 * Based on: "Pseudocode Guide for Teachers" — Cambridge International
 * AS & A Level Computer Science 9618 (use for exams in 2026), Version 1.
 */

/** Built-in data types (section 2.1). */
export const DATA_TYPES = ['INTEGER', 'REAL', 'CHAR', 'STRING', 'BOOLEAN', 'DATE'] as const;

/** Boolean literals (section 2.2). */
export const BOOLEAN_LITERALS = ['TRUE', 'FALSE'] as const;

/** Word operators (sections 5.2–5.4). */
export const OPERATOR_KEYWORDS = ['AND', 'OR', 'NOT', 'DIV', 'MOD'] as const;

/** File access modes (section 9.1). */
export const FILE_MODES = ['READ', 'WRITE', 'APPEND', 'RANDOM'] as const;

/**
 * Structural / statement keywords (all constructs in the guide).
 * Kept as a plain list; the parser matches by exact uppercase text.
 */
export const KEYWORDS = [
  'IF', 'THEN', 'ELSE', 'ENDIF',
  'CASE', 'OF', 'OTHERWISE', 'ENDCASE',
  'FOR', 'TO', 'STEP', 'NEXT',
  'REPEAT', 'UNTIL',
  'WHILE', 'ENDWHILE',
  'PROCEDURE', 'ENDPROCEDURE', 'FUNCTION', 'ENDFUNCTION', 'RETURNS', 'RETURN', 'CALL',
  'CLASS', 'ENDCLASS', 'INHERITS', 'SUPER', 'NEW',
  'TYPE', 'ENDTYPE', 'DEFINE', 'DECLARE', 'CONSTANT',
  'PUBLIC', 'PRIVATE', 'BYREF', 'BYVAL',
  'INPUT', 'OUTPUT',
  'OPENFILE', 'READFILE', 'WRITEFILE', 'CLOSEFILE', 'SEEK', 'GETRECORD', 'PUTRECORD',
] as const;

/** Built-in functions with their signatures and documentation (sections 5.5, 5.6, 9.1). */
export interface BuiltinFunction {
  name: string;
  /** Parameter name + declared pseudo-type (null = untyped, e.g. file handle). */
  params: Array<{ name: string; type: string | null }>;
  /** Return type (null = untyped). */
  returns: string | null;
  /** One-line description of the function. */
  doc: string;
}

export const BUILTIN_FUNCTIONS: Record<string, BuiltinFunction> = {
  RIGHT: {
    name: 'RIGHT',
    params: [{ name: 'ThisString', type: 'STRING' }, { name: 'x', type: 'INTEGER' }],
    returns: 'STRING',
    doc: 'Returns the rightmost x characters from ThisString.',
  },
  LENGTH: {
    name: 'LENGTH',
    params: [{ name: 'ThisString', type: 'STRING' }],
    returns: 'INTEGER',
    doc: 'Returns the integer value representing the length of ThisString.',
  },
  MID: {
    name: 'MID',
    params: [
      { name: 'ThisString', type: 'STRING' },
      { name: 'x', type: 'INTEGER' },
      { name: 'y', type: 'INTEGER' },
    ],
    returns: 'STRING',
    doc: 'Returns a string of length y starting at position x from ThisString.',
  },
  LCASE: {
    name: 'LCASE',
    params: [{ name: 'ThisChar', type: 'CHAR' }],
    returns: 'CHAR',
    doc: 'Returns the lower-case equivalent of ThisChar (unchanged if already lower-case).',
  },
  UCASE: {
    name: 'UCASE',
    params: [{ name: 'ThisChar', type: 'CHAR' }],
    returns: 'CHAR',
    doc: 'Returns the upper-case equivalent of ThisChar (unchanged if already upper-case).',
  },
  INT: {
    name: 'INT',
    params: [{ name: 'x', type: 'REAL' }],
    returns: 'INTEGER',
    doc: 'Returns the integer part of x.',
  },
  RAND: {
    name: 'RAND',
    params: [{ name: 'x', type: 'INTEGER' }],
    returns: 'REAL',
    doc: 'Returns a random real number in the range 0 to x (not inclusive of x).',
  },
  EOF: {
    name: 'EOF',
    params: [{ name: 'FileIdentifier', type: null }],
    returns: 'BOOLEAN',
    doc: 'Returns TRUE if there are no more lines to read from the given file, FALSE otherwise.',
  },
};

/** Block construct → its terminating keyword (used by the parser and formatter). */
export const BLOCK_TERMINATORS: Record<string, string> = {
  IF: 'ENDIF',
  CASE: 'ENDCASE',
  FOR: 'NEXT',
  REPEAT: 'UNTIL',
  WHILE: 'ENDWHILE',
  PROCEDURE: 'ENDPROCEDURE',
  FUNCTION: 'ENDFUNCTION',
  TYPE: 'ENDTYPE',
  CLASS: 'ENDCLASS',
};

/** Words that terminate (close) a block — used by the formatter. */
export const CLOSING_KEYWORDS = new Set<string>([
  'ENDIF', 'ENDCASE', 'ENDWHILE', 'ENDPROCEDURE', 'ENDFUNCTION', 'ENDTYPE', 'ENDCLASS',
  'NEXT', 'UNTIL', 'ELSE',
]);

/** Words that open a block when they start a line — used by the formatter. */
export const OPENING_KEYWORDS = new Set<string>([
  'IF', 'FOR', 'WHILE', 'REPEAT', 'PROCEDURE', 'FUNCTION', 'CLASS', 'CASE', 'TYPE',
]);

/** Full keyword registry used by the scanner to classify a word. */
const ALL_WORDS = new Set<string>([
  ...KEYWORDS,
  ...DATA_TYPES,
  ...OPERATOR_KEYWORDS,
  ...BOOLEAN_LITERALS,
  ...FILE_MODES,
  ...Object.keys(BUILTIN_FUNCTIONS),
]);

export type WordKind = 'keyword' | 'type' | 'builtin' | 'boolean' | 'operator' | 'identifier';

/** Classify a mixed-case word into its lexical category (case-sensitive). */
export function classifyWord(word: string): WordKind {
  if (DATA_TYPES.includes(word as (typeof DATA_TYPES)[number])) return 'type';
  if (BOOLEAN_LITERALS.includes(word as (typeof BOOLEAN_LITERALS)[number])) return 'boolean';
  if (OPERATOR_KEYWORDS.includes(word as (typeof OPERATOR_KEYWORDS)[number])) return 'operator';
  if (word in BUILTIN_FUNCTIONS) return 'builtin';
  if (ALL_WORDS.has(word)) return 'keyword';
  return 'identifier';
}

/** Is this a reserved word of the language? */
export function isReservedWord(word: string): boolean {
  return ALL_WORDS.has(word);
}

/** Data types usable inside `DECLARE x : <type>` (built-ins + anything else is a user type). */
export function isBuiltinType(word: string): boolean {
  return DATA_TYPES.includes(word as (typeof DATA_TYPES)[number]);
}

/** Keywords offered by the completion provider (excludes types/builtins, added separately). */
export const COMPLETION_KEYWORDS: ReadonlyArray<{ label: string; insertText?: string; doc: string }> = [
  { label: 'IF', insertText: 'IF ${1:condition} THEN\n\t${2:statement(s)}\nENDIF', doc: 'Selection — IF..THEN..ENDIF' },
  { label: 'IF…ELSE', insertText: 'IF ${1:condition} THEN\n\t${2:statement(s)}\nELSE\n\t${3:statement(s)}\nENDIF', doc: 'Selection — IF..THEN..ELSE..ENDIF' },
  { label: 'CASE OF', insertText: 'CASE OF ${1:identifier}\n\t${2:value} : ${3:statement}\n\tOTHERWISE : ${4:statement}\nENDCASE', doc: 'Selection — CASE OF..ENDCASE' },
  { label: 'FOR', insertText: 'FOR ${1:Index} ← ${2:1} TO ${3:10}${4: STEP ${5:1}}\n\t${6:statement(s)}\nNEXT ${1:Index}', doc: 'Count-controlled iteration (FOR..NEXT)' },
  { label: 'REPEAT', insertText: 'REPEAT\n\t${1:statement(s)}\nUNTIL ${2:condition}', doc: 'Post-condition iteration (REPEAT..UNTIL)' },
  { label: 'WHILE', insertText: 'WHILE ${1:condition}\n\t${2:statement(s)}\nENDWHILE', doc: 'Pre-condition iteration (WHILE..ENDWHILE)' },
  { label: 'PROCEDURE', insertText: 'PROCEDURE ${1:Name}(${2:Param : INTEGER})\n\t${3:statement(s)}\nENDPROCEDURE', doc: 'Procedure definition' },
  { label: 'FUNCTION', insertText: 'FUNCTION ${1:Name}(${2:Param : INTEGER}) RETURNS ${3:INTEGER}\n\t${4:statement(s)}\nENDFUNCTION', doc: 'Function definition' },
  { label: 'CLASS', insertText: 'CLASS ${1:Name}${2: INHERITS ${3:Parent}}\n\t${4:members}\nENDCLASS', doc: 'Class definition (OOP)' },
  { label: 'TYPE', insertText: 'TYPE ${1:Name} = (${2:value1}, ${3:value2})', doc: 'User-defined (enumerated) data type' },
  { label: 'DECLARE', insertText: 'DECLARE ${1:Name} : ${2:INTEGER}', doc: 'Variable declaration' },
  { label: 'CONSTANT', insertText: 'CONSTANT ${1:Name} = ${2:value}', doc: 'Constant declaration' },
  { label: 'INPUT', insertText: 'INPUT ${1:identifier}', doc: 'Read a value into a variable' },
  { label: 'OUTPUT', insertText: 'OUTPUT ${1:value}', doc: 'Output one or more values to the screen' },
  { label: 'CALL', insertText: 'CALL ${1:ProcedureName}(${2:args})', doc: 'Call a procedure' },
  { label: 'RETURN', insertText: 'RETURN ${1:value}', doc: 'Return a value from a function' },
  { label: 'OPENFILE', insertText: 'OPENFILE ${1:"FileName.txt"} FOR READ', doc: 'Open a file for READ / WRITE / APPEND / RANDOM' },
];