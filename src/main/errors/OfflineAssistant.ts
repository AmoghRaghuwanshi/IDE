// ============================================================================
// Offline Error Assistant — deterministic, rule-based template matcher
// ============================================================================

import type { LanguageId } from '../../shared/types'

interface ErrorRule {
  /** Regex pattern to match against the raw error message */
  pattern: string
  /** Friendly explanation template. Use $1, $2 etc. for capture groups */
  explanation: string
  /** Languages this rule applies to */
  languages: LanguageId[]
}

// ============================================================================
// Error Rules Database
// ============================================================================

const ERROR_RULES: ErrorRule[] = [
  // ---- C/C++ Common Errors ----
  {
    pattern: "expected '([^']+)' before '([^']+)'",
    explanation:
      "You may be missing a `$1` before `$2`. Check the line above for a missing semicolon, parenthesis, or brace.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "expected '([^']+)' at end of input",
    explanation:
      "A closing `$1` seems to be missing — check that every opening brace, parenthesis, or bracket has a matching close.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "'([^']+)' was not declared in this scope",
    explanation:
      "The variable or function `$1` is used here but hasn't been declared yet. Check for typos, or make sure it's declared before this point.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "'([^']+)' undeclared",
    explanation:
      "The identifier `$1` hasn't been declared. Did you forget to include a header file, or is there a typo?",
    languages: ['c', 'cpp']
  },
  {
    pattern: "implicit declaration of function '([^']+)'",
    explanation:
      "The function `$1` is being called without a prior declaration. Include the appropriate header file or add a function prototype.",
    languages: ['c']
  },
  {
    pattern: 'incompatible types when (.*)',
    explanation:
      'Type mismatch: $1. Make sure both sides of the assignment or comparison use compatible types.',
    languages: ['c', 'cpp']
  },
  {
    pattern: "invalid conversion from '([^']+)' to '([^']+)'",
    explanation:
      "Cannot automatically convert from `$1` to `$2`. You may need an explicit cast or should check your types.",
    languages: ['cpp']
  },
  {
    pattern: 'control reaches end of non-void function',
    explanation:
      "This function is supposed to return a value, but there's a code path that doesn't return anything. Add a `return` statement.",
    languages: ['c', 'cpp']
  },
  {
    pattern: 'unused variable \'([^\']+)\'',
    explanation:
      "The variable `$1` is declared but never used. You can remove it or use it in your code.",
    languages: ['c', 'cpp']
  },
  {
    pattern: 'unused parameter \'([^\']+)\'',
    explanation:
      "The function parameter `$1` is never used in the function body. This is usually fine but can indicate forgotten logic.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "format '([^']+)' expects argument of type '([^']+)', but argument \\d+ has type '([^']+)'",
    explanation:
      "The format specifier `$1` expects a `$2` value, but you're passing a `$3`. Use the correct format specifier.",
    languages: ['c']
  },
  {
    pattern: 'comparison between signed and unsigned',
    explanation:
      "You're comparing a signed integer with an unsigned integer. This can cause unexpected behavior with negative numbers.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "no match for 'operator([^']+)' in",
    explanation:
      "The `$1` operator isn't defined for these types. Check that the types support this operation, or define the operator.",
    languages: ['cpp']
  },
  {
    pattern: "no matching function for call to '([^']+)'",
    explanation:
      "No function named `$1` matches the arguments you're passing. Check the number and types of arguments.",
    languages: ['cpp']
  },
  {
    pattern: "redefinition of '([^']+)'",
    explanation:
      "`$1` is defined more than once. Each variable or function should be defined only once in the same scope.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "use of undeclared identifier '([^']+)'",
    explanation:
      "The identifier `$1` hasn't been declared. Check for typos, or make sure it's defined before this line.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "expected unqualified-id",
    explanation:
      "Something unexpected was found where a name (variable, function, type) was expected. Check for stray characters or missing semicolons above this line.",
    languages: ['c', 'cpp']
  },
  {
    pattern: "too (few|many) arguments to function",
    explanation:
      "You're passing the wrong number of arguments to this function. Check the function declaration for the correct parameter count.",
    languages: ['c', 'cpp']
  },

  // ---- Python Common Errors ----
  {
    pattern: "SyntaxError: invalid syntax",
    explanation:
      "Python found something it didn't expect. Common causes: missing colon `:` at the end of `if`/`for`/`while`/`def`, mismatched parentheses, or a typo.",
    languages: ['python']
  },
  {
    pattern: "SyntaxError: unexpected EOF while parsing",
    explanation:
      "Python reached the end of your code while still expecting more. You're likely missing a closing parenthesis `)`, bracket `]`, or brace `}`.",
    languages: ['python']
  },
  {
    pattern: "SyntaxError: EOL while scanning string literal",
    explanation:
      "A string isn't properly closed. Make sure every opening quote has a matching closing quote on the same line (or use triple quotes for multi-line strings).",
    languages: ['python']
  },
  {
    pattern: "IndentationError: (.*)",
    explanation:
      "This line's indentation doesn't match the surrounding code block — Python uses indentation to define blocks. $1",
    languages: ['python']
  },
  {
    pattern: "TabError: (.*)",
    explanation:
      "Python found a mix of tabs and spaces for indentation. Use spaces consistently (4 spaces per level is standard).",
    languages: ['python']
  },
  {
    pattern: "NameError: name '([^']+)' is not defined",
    explanation:
      "The variable or function `$1` doesn't exist at this point. Check for typos, or make sure it's defined before this line.",
    languages: ['python']
  },
  {
    pattern: "TypeError: (.+) takes (\\d+) positional arguments? but (\\d+) (?:was|were) given",
    explanation:
      "You called `$1` with $3 arguments, but it only accepts $2. Check the function definition for the correct number of parameters.",
    languages: ['python']
  },
  {
    pattern: "TypeError: unsupported operand type\\(s\\) for (.+): '([^']+)' and '([^']+)'",
    explanation:
      "The `$1` operation doesn't work between types `$2` and `$3`. You may need to convert one of them first.",
    languages: ['python']
  },
  {
    pattern: "TypeError: can only concatenate (.+) \\(not \"(.+)\"\\) to (.+)",
    explanation:
      "You can't directly combine $1 and $2. Use `str()` to convert numbers to strings, or use the correct type.",
    languages: ['python']
  },
  {
    pattern: "IndexError: list index out of range",
    explanation:
      "You're trying to access a list element at a position that doesn't exist. Remember that list indices start at 0.",
    languages: ['python']
  },
  {
    pattern: "KeyError: (.+)",
    explanation:
      "The key $1 doesn't exist in the dictionary. Use `.get()` to safely access keys, or check with `in` first.",
    languages: ['python']
  },
  {
    pattern: "ValueError: (.+)",
    explanation: "$1. The value you provided isn't valid for this operation.",
    languages: ['python']
  },
  {
    pattern: "AttributeError: '([^']+)' object has no attribute '([^']+)'",
    explanation:
      "The `$1` type doesn't have a method or property called `$2`. Check the spelling or the type of the object.",
    languages: ['python']
  },
  {
    pattern: "ImportError: No module named '([^']+)'",
    explanation:
      "Python can't find the module `$1`. Make sure it's installed (`pip install $1`) and spelled correctly.",
    languages: ['python']
  },
  {
    pattern: "ModuleNotFoundError: No module named '([^']+)'",
    explanation:
      "The module `$1` isn't installed. Install it with `pip install $1`, or check the module name for typos.",
    languages: ['python']
  },
  {
    pattern: "ZeroDivisionError: division by zero",
    explanation:
      "You tried to divide by zero. Add a check to make sure the divisor isn't zero before dividing.",
    languages: ['python']
  },
  {
    pattern: "RecursionError: maximum recursion depth exceeded",
    explanation:
      "Your function is calling itself too many times (infinite recursion). Make sure your recursive function has a proper base case that stops the recursion.",
    languages: ['python']
  },
  {
    pattern: "FileNotFoundError: .+No such file or directory: '([^']+)'",
    explanation:
      "The file `$1` doesn't exist. Check that the path is correct and the file exists.",
    languages: ['python']
  }
]

// ============================================================================
// Matcher
// ============================================================================

/**
 * Tries to match a raw error message against the rule table.
 * Returns a friendly explanation, or null if no rule matches.
 */
export function getOfflineExplanation(
  rawMessage: string,
  language: LanguageId
): string | null {
  for (const rule of ERROR_RULES) {
    if (!rule.languages.includes(language)) continue

    const regex = new RegExp(rule.pattern, 'i')
    const match = regex.exec(rawMessage)
    if (match) {
      // Replace $1, $2, ... with captured groups
      let explanation = rule.explanation
      for (let i = 1; i < match.length; i++) {
        explanation = explanation.replace(new RegExp(`\\$${i}`, 'g'), match[i] || '')
      }
      return explanation
    }
  }

  // No rule matched — return null (caller will show honest fallback)
  return null
}
