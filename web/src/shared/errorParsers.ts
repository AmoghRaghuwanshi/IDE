// ============================================================================
// Shared Error Parsers and Deterministic Explanations
// ============================================================================

import type { NormalizedError, LanguageId } from './types'

interface ErrorRule {
  pattern: string
  explanation: string
  languages: LanguageId[]
}

const ERROR_RULES: ErrorRule[] = [
  // ---- C/C++ Common Errors ----
  {
    pattern: "expected '([^']+)' before '([^']+)'",
    explanation: "You may be missing a `$1` before `$2`. Check the line above for a missing semicolon, parenthesis, or brace.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "expected '([^']+)' at end of input",
    explanation: "A closing `$1` seems to be missing — check that every opening brace, parenthesis, or bracket has a matching close.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "'([^']+)' was not declared in this scope",
    explanation: "The variable or function `$1` is used here but hasn't been declared yet. Check for typos, or make sure it's declared before this point.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "'([^']+)' undeclared",
    explanation: "The identifier `$1` hasn't been declared. Did you forget to include a header file, or is there a typo?",
    languages: ['c', 'cpp']
  },
  {
    pattern: "implicit declaration of function '([^']+)'",
    explanation: "The function `$1` is being called without a prior declaration. Include the appropriate header file or add a function prototype.",
    languages: ['c']
  },
  {
    pattern: "undefined reference to `([^']+)'",
    explanation: "The compiler found a reference to `$1`, but couldn't find its definition. Did you misspell the function name or forget to link a library?",
    languages: ['c', 'cpp']
  },
  {
    pattern: "undefined reference to '([^']+)'",
    explanation: "The compiler found a reference to `$1`, but couldn't find its definition. Did you misspell the function name or forget to link a library?",
    languages: ['c', 'cpp']
  },
  {
    pattern: "cannot convert '([^']+)' to '([^']+)'",
    explanation: "Type mismatch: tried to use a value of type `$1` where `$2` was expected. Consider an explicit cast or changing variable types.",
    languages: ['cpp']
  },
  {
    pattern: "incompatible types when assigning to type '([^']+)' from type '([^']+)'",
    explanation: "Cannot assign a value of type `$2` to a variable of type `$1`. Check the data types.",
    languages: ['c']
  },
  {
    pattern: "assignment to expression with array type",
    explanation: "In C/C++, you cannot assign one array directly to another with `=`. Use `memcpy`, `strcpy`, or a loop to copy elements.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "subscripted value is neither array nor pointer",
    explanation: "You used `[ ]` on something that isn't an array or pointer. Check the variable type.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "format '([^']+)' expects argument of type '([^']+)', but argument (\\d+) has type '([^']+)'",
    explanation: "printf/scanf format specifier `$1` expects `$2`, but argument $3 has type `$4`. Ensure your format string matches your variables.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "control reaches end of non-void function",
    explanation: "This function is declared to return a value, but some execution paths don't return anything. Add a return statement.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "unused variable '([^']+)'",
    explanation: "Variable `$1` was declared but never used in the function.",
    languages: ['c', 'cpp']
  },

  // ---- Python Common Errors ----
  {
    pattern: "SyntaxError: invalid syntax",
    explanation: "Python encountered invalid syntax. Check for missing colons at the end of `if`/`for`/`def` lines, unmatched parentheses, or typos.",
    languages: ['python']
  },
  {
    pattern: "SyntaxError: expected '([^']+)'",
    explanation: "Python was expecting `$1` here. Check if you missed a colon, quote, or closing parenthesis.",
    languages: ['python']
  },
  {
    pattern: "IndentationError: unexpected indent",
    explanation: "This line has extra spaces at the beginning that don't match the indentation of the surrounding block.",
    languages: ['python']
  },
  {
    pattern: "IndentationError: expected an indented block",
    explanation: "Python expects an indented block of code after statements like `if`, `for`, `def`, or `while`. Add at least one indented line.",
    languages: ['python']
  },
  {
    pattern: "IndentationError: unindent does not match any outer indentation level",
    explanation: "The indentation here doesn't align with any previous indentation level. Make sure you use a consistent number of spaces (e.g. 4 spaces).",
    languages: ['python']
  },
  {
    pattern: "NameError: name '([^']+)' is not defined",
    explanation: "`$1` hasn't been defined yet. Check for typos in the variable/function name, or define it before using it.",
    languages: ['python']
  },
  {
    pattern: "TypeError: unsupported operand type\\(s\\) for ([^:]+): '([^']+)' and '([^']+)'",
    explanation: "Cannot perform operation $1 between `$2` and `$3`. You may need to convert types (e.g. `int()` or `str()`).",
    languages: ['python']
  },
  {
    pattern: "TypeError: '([^']+)' object is not subscriptable",
    explanation: "You tried to use `[ ]` indexing on a `$1`, but this type doesn't support indexing. Check that the variable holds a list, dict, or string.",
    languages: ['python']
  },
  {
    pattern: "TypeError: '([^']+)' object is not callable",
    explanation: "You tried to call `$1` like a function with `( )`, but it's not a function. Check if you accidentally overwrote a function name with a variable.",
    languages: ['python']
  },
  {
    pattern: "TypeError: ([^\\(]+)\\(\\) takes (\\d+) positional arguments? but (\\d+) (?:was|were) given",
    explanation: "Function `$1` expects $2 argument(s), but $3 were provided. Check the function definition.",
    languages: ['python']
  },
  {
    pattern: "IndexError: list index out of range",
    explanation: "You tried to access an index that doesn't exist in the list. Remember that Python uses 0-based indexing (0 to length - 1).",
    languages: ['python']
  },
  {
    pattern: "KeyError: '([^']+)'",
    explanation: "The key `'$1'` was not found in the dictionary. Use `.get('$1')` or check if the key exists with `if '$1' in dict:`.",
    languages: ['python']
  },
  {
    pattern: "ValueError: invalid literal for int\\(\\) with base 10: '([^']*)'",
    explanation: "Cannot convert `'$1'` to an integer. The input contains non-numeric characters.",
    languages: ['python']
  },
  {
    pattern: "ZeroDivisionError: division by zero",
    explanation: "Attempted to divide by zero. Add a check to ensure the divisor is non-zero before dividing.",
    languages: ['python']
  },
  {
    pattern: "AttributeError: '([^']+)' object has no attribute '([^']+)'",
    explanation: "`$1` objects don't have a method or property called `$2`. Check the spelling or the object's type.",
    languages: ['python']
  },
  {
    pattern: "RecursionError: maximum recursion depth exceeded",
    explanation: "The function called itself too many times. Ensure your recursive function has a base case that stops recursion.",
    languages: ['python']
  }
]

export function getOfflineExplanation(rawMessage: string, language: LanguageId): string {
  const trimmed = rawMessage.trim()
  for (const rule of ERROR_RULES) {
    if (!rule.languages.includes(language)) continue
    try {
      const regex = new RegExp(rule.pattern, 'i')
      const match = regex.exec(trimmed)
      if (match) {
        let explanation = rule.explanation
        for (let i = 1; i < match.length; i++) {
          explanation = explanation.replaceAll(`$${i}`, match[i] ?? '')
        }
        return explanation
      }
    } catch {
      continue
    }
  }
  return trimmed
}

export function parseGccErrors(stderr: string, language: LanguageId): NormalizedError[] {
  if (!stderr || stderr.trim().length === 0) return []
  const errors: NormalizedError[] = []
  const lines = stderr.split(/\r?\n/)

  const mainPattern = /^(.+?):(\d+):(\d+):\s+(error|warning|note):\s+(.*)$/
  const funcPattern = /^(.+?):\s+In function\s+'(.+?)':/

  let currentFunction: string | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const funcMatch = funcPattern.exec(line)
    if (funcMatch) {
      currentFunction = funcMatch[2]
      continue
    }

    const mainMatch = mainPattern.exec(line)
    if (mainMatch) {
      const [, file, lineNum, colNum, severity, message] = mainMatch
      const rawMessage = message.trim()
      const simplified = getOfflineExplanation(rawMessage, language)

      errors.push({
        language,
        severity: severity as 'error' | 'warning' | 'note',
        file: file.trim(),
        line: parseInt(lineNum, 10),
        column: parseInt(colNum, 10),
        functionContext: currentFunction,
        rawMessage,
        simplifiedMessage: simplified
      })
    }
  }

  return errors
}

export function parsePythonErrors(stderr: string): NormalizedError[] {
  if (!stderr || stderr.trim().length === 0) return []
  const errors: NormalizedError[] = []
  const lines = stderr.split(/\r?\n/)

  const fileLinePattern = /^\s*File\s+"(.+?)",\s+line\s+(\d+)/
  const exceptionPattern = /^(\w+(?:Error|Exception|Warning)):\s*(.*)$/

  let lastFile: string | null = null
  let lastLine: number | null = null
  let lastColumn: number | null = null

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    const fileMatch = fileLinePattern.exec(line)
    if (fileMatch) {
      lastFile = fileMatch[1]
      lastLine = parseInt(fileMatch[2], 10)
      lastColumn = null

      if (i + 2 < lines.length && lines[i + 2].trim().startsWith('^')) {
        const caretLine = lines[i + 2]
        lastColumn = caretLine.indexOf('^') + 1
      }
      continue
    }

    const exceptionMatch = exceptionPattern.exec(line.trim())
    if (exceptionMatch) {
      const [, exceptionType, message] = exceptionMatch
      const rawMessage = `${exceptionType}: ${message}`
      const simplified = getOfflineExplanation(rawMessage, 'python')

      if (lastFile && lastLine !== null) {
        errors.push({
          language: 'python',
          severity: 'error',
          file: lastFile,
          line: lastLine,
          column: lastColumn,
          functionContext: null,
          rawMessage,
          simplifiedMessage: simplified
        })
      } else {
        errors.push({
          language: 'python',
          severity: 'error',
          file: 'main.py',
          line: 1,
          column: null,
          functionContext: null,
          rawMessage,
          simplifiedMessage: simplified
        })
      }
    }
  }

  return errors
}
