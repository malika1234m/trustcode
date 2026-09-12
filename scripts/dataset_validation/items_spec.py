"""TrustCode benchmark v1 - item specifications (source of truth).

Authored for this project (licence: CC-BY-4.0). Code snippets imitate typical AI-assistant
output for short tasks. Item classes:
  C1 correct, clean checks           C2 correct, spurious (false-positive) warning
  D1 defect detectable by the checks D2 defect outside the checks' coverage (tool-blind)
Ground truth is defined by `hidden_tests` (behavioural defects) or a documented
security property. Labels were authored by the developer of TrustCode with LLM
assistance and MUST be independently reviewed (see datasets/benchmark_validation.md).
`baseline_explanation` imitates a conventional assistant's description of its own code:
same style for every item, describes intent, does not mention defects.
"""

PY_TEST_HDR = "from solution import *\n"
JS_TEST_HDR = "const test = require('node:test');\nconst assert = require('node:assert');\nconst m = require('./solution');\n"

ITEMS = [
    # ============================ PYTHON ============================
    dict(id="PY-C1-01", language="python", cls="C1", block="A", split="eval",
         task="Write median(values) that returns the median of a non-empty list of numbers.",
         code='''def median(values):
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    if n % 2 == 1:
        return ordered[mid]
    return (ordered[mid - 1] + ordered[mid]) / 2
''',
         visible_tests=PY_TEST_HDR + '''def test_odd():
    assert median([3, 1, 2]) == 2

def test_even():
    assert median([4, 1, 3, 2]) == 2.5
''',
         hidden_tests=PY_TEST_HDR + '''def test_single():
    assert median([7]) == 7

def test_negative_and_float():
    assert median([-5, -1.5, 3]) == -1.5

def test_does_not_mutate():
    v = [3, 1, 2]
    median(v)
    assert v == [3, 1, 2]
''',
         defect=None, explanation_gt="Correct for all non-empty numeric lists; does not mutate input.",
         baseline_explanation="This function sorts a copy of the list and returns the middle element. For an even number of values it returns the average of the two middle values, which is the standard definition of the median."),
    dict(id="PY-C1-02", language="python", cls="C1", block="B", split="eval",
         task="Write parse_pairs(text) that parses 'key=value' pairs separated by ';' into a dict. Strip whitespace around keys and values and ignore empty segments.",
         code='''def parse_pairs(text):
    result = {}
    for segment in text.split(";"):
        segment = segment.strip()
        if not segment:
            continue
        key, _, value = segment.partition("=")
        result[key.strip()] = value.strip()
    return result
''',
         visible_tests=PY_TEST_HDR + '''def test_basic():
    assert parse_pairs("a=1;b=2") == {"a": "1", "b": "2"}

def test_whitespace():
    assert parse_pairs(" a = 1 ; b=2 ") == {"a": "1", "b": "2"}
''',
         hidden_tests=PY_TEST_HDR + '''def test_empty_segments():
    assert parse_pairs("a=1;;b=2;") == {"a": "1", "b": "2"}

def test_empty_string():
    assert parse_pairs("") == {}

def test_value_with_equals():
    assert parse_pairs("url=a=b") == {"url": "a=b"}
''',
         defect=None, explanation_gt="Handles empty segments, empty input and '=' inside values.",
         baseline_explanation="This function splits the text on semicolons, skips empty segments, and splits each segment at the first '=' into a key and value, stripping surrounding whitespace before adding them to the dictionary."),
    dict(id="PY-C2-01", language="python", cls="C2", block="A", split="eval",
         task="Write shuffled_questions(questions) that returns a new list with the quiz questions in random display order, without modifying the input. This is for display only (not security-sensitive).",
         code='''import random


def shuffled_questions(questions):
    copy = list(questions)
    random.shuffle(copy)
    return copy
''',
         visible_tests=PY_TEST_HDR + '''def test_same_items():
    qs = ["q1", "q2", "q3"]
    assert sorted(shuffled_questions(qs)) == qs
''',
         hidden_tests=PY_TEST_HDR + '''def test_input_unchanged():
    qs = ["q1", "q2", "q3"]
    shuffled_questions(qs)
    assert qs == ["q1", "q2", "q3"]

def test_empty():
    assert shuffled_questions([]) == []
''',
         defect=None, explanation_gt="Correct. The insecure-random warning is a false positive: display order is not security-relevant.",
         baseline_explanation="This function copies the list of questions and shuffles the copy with Python's random module, so the original list is left unchanged and a new randomly ordered list is returned."),
    dict(id="PY-C2-02", language="python", cls="C2", block="B", split="eval",
         task="Write cache_key(content: bytes) that returns a short hexadecimal key for caching rendered pages by their content. Collisions only cause a cache miss; this is not security-sensitive.",
         code='''import hashlib


def cache_key(content):
    return hashlib.md5(content).hexdigest()
''',
         visible_tests=PY_TEST_HDR + '''def test_deterministic():
    assert cache_key(b"page") == cache_key(b"page")

def test_length():
    assert len(cache_key(b"page")) == 32
''',
         hidden_tests=PY_TEST_HDR + '''def test_distinct():
    assert cache_key(b"a") != cache_key(b"b")

def test_empty():
    assert len(cache_key(b"")) == 32
''',
         defect=None, explanation_gt="Correct for a non-security cache key. The weak-hash warning is a false positive in this context.",
         baseline_explanation="This function hashes the page content with MD5 and returns the hexadecimal digest, which gives a short, deterministic key that can be used to look up cached pages."),
    dict(id="PY-D1-01", language="python", cls="D1", block="A", split="eval",
         task="Write find_user(conn, username) that returns the row for the given username from the 'users' table of a sqlite3 connection, or None.",
         code='''def find_user(conn, username):
    query = f"SELECT id, username FROM users WHERE username = '{username}'"
    return conn.execute(query).fetchone()
''',
         visible_tests=PY_TEST_HDR + '''import sqlite3

def _db():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE users (id INTEGER, username TEXT)")
    c.execute("INSERT INTO users VALUES (1, 'alice')")
    return c

def test_found():
    assert find_user(_db(), "alice") == (1, "alice")

def test_missing():
    assert find_user(_db(), "bob") is None
''',
         hidden_tests=PY_TEST_HDR + '''import sqlite3

def _db():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE users (id INTEGER, username TEXT)")
    c.execute("INSERT INTO users VALUES (1, 'alice')")
    c.execute("INSERT INTO users VALUES (2, 'o''brien')")
    return c

def test_quote_in_name():
    assert find_user(_db(), "o'brien") == (2, "o'brien")

def test_injection_returns_nothing():
    assert find_user(_db(), "x' OR '1'='1") is None
''',
         defect="SQL injection (CWE-89): username is interpolated into SQL; quotes break the query and injection returns other users' rows.",
         explanation_gt="Defective: must use a parameterised query.",
         baseline_explanation="This function builds a SELECT query for the given username and runs it on the provided sqlite3 connection, returning the first matching row or None if no user matches."),
    dict(id="PY-D1-02", language="python", cls="D1", block="B", split="eval",
         task="Write last_n(items, n) that returns the last n elements of a list (an empty list when n is 0).",
         code='''def last_n(items, n):
    return items[-n:]
''',
         visible_tests=PY_TEST_HDR + '''def test_two():
    assert last_n([1, 2, 3], 2) == [2, 3]

def test_zero():
    assert last_n([1, 2, 3], 0) == []
''',
         hidden_tests=PY_TEST_HDR + '''def test_zero():
    assert last_n([1, 2, 3], 0) == []

def test_more_than_len():
    assert last_n([1, 2], 5) == [1, 2]
''',
         defect="items[-0:] returns the whole list, so n = 0 returns every element. The supplied test test_zero fails.",
         explanation_gt="Defective for n = 0; detected by a supplied test.",
         baseline_explanation="This function uses Python's negative slicing to return the last n elements of the list in their original order."),
    dict(id="PY-D2-01", language="python", cls="D2", block="A", split="eval",
         task="Write is_leap_year(year) for the Gregorian calendar.",
         code='''def is_leap_year(year):
    return year % 4 == 0
''',
         visible_tests=PY_TEST_HDR + '''def test_leap():
    assert is_leap_year(2024)

def test_common():
    assert not is_leap_year(2023)
''',
         hidden_tests=PY_TEST_HDR + '''def test_century():
    assert not is_leap_year(1900)

def test_400():
    assert is_leap_year(2000)
''',
         defect="Ignores the century rule: 1900 is reported as a leap year.",
         explanation_gt="Defective for years divisible by 100 but not by 400; no supplied test or rule covers this.",
         baseline_explanation="This function checks whether the year is divisible by 4 and returns True for leap years and False otherwise."),
    dict(id="PY-D2-02", language="python", cls="D2", block="B", split="eval",
         task="Write average(values) that returns the arithmetic mean of a list of numbers, or 0.0 for an empty list.",
         code='''def average(values):
    return sum(values) / len(values)
''',
         visible_tests=PY_TEST_HDR + '''def test_ints():
    assert average([1, 2, 3]) == 2

def test_floats():
    assert average([0.5, 1.5]) == 1.0
''',
         hidden_tests=PY_TEST_HDR + '''def test_empty():
    assert average([]) == 0.0
''',
         defect="Raises ZeroDivisionError for an empty list instead of returning 0.0 as the task requires.",
         explanation_gt="Defective for the empty-list requirement; every line is executed by the supplied tests, so coverage does not reveal it.",
         baseline_explanation="This function adds up the values and divides by how many there are, returning the arithmetic mean."),
    # ============================ JAVASCRIPT ============================
    dict(id="JS-C1-01", language="javascript", cls="C1", block="A", split="eval",
         task="Write titleCase(text) that capitalises the first letter of each word and lower-cases the rest. Words are separated by single spaces.",
         code='''function titleCase(text) {
  return text
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ');
}

module.exports = { titleCase };
''',
         visible_tests=JS_TEST_HDR + '''test('basic', () => assert.strictEqual(m.titleCase('hello world'), 'Hello World'));
test('mixed case', () => assert.strictEqual(m.titleCase('hELLO'), 'Hello'));
''',
         hidden_tests=JS_TEST_HDR + '''test('empty', () => assert.strictEqual(m.titleCase(''), ''));
test('single letter words', () => assert.strictEqual(m.titleCase('a b'), 'A B'));
''',
         defect=None, explanation_gt="Correct for the specified input format, including the empty string.",
         baseline_explanation="This function splits the text into words, upper-cases the first letter of each word, lower-cases the remaining letters and joins the words back together with spaces."),
    dict(id="JS-C1-02", language="javascript", cls="C1", block="B", split="eval",
         task="Write clamp(value, min, max) that limits value to the inclusive range [min, max]. Assume min <= max.",
         code='''function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

module.exports = { clamp };
''',
         visible_tests=JS_TEST_HDR + '''test('inside', () => assert.strictEqual(m.clamp(5, 0, 10), 5));
test('below', () => assert.strictEqual(m.clamp(-1, 0, 10), 0));
''',
         hidden_tests=JS_TEST_HDR + '''test('above', () => assert.strictEqual(m.clamp(11, 0, 10), 10));
test('equal bounds', () => assert.strictEqual(m.clamp(3, 2, 2), 2));
''',
         defect=None, explanation_gt="Correct.",
         baseline_explanation="This function raises the value to at least min and then caps it at max, so the result always lies within the inclusive range."),
    dict(id="JS-C2-01", language="javascript", cls="C2", block="A", split="eval",
         task="Write randomAvatarColour(palette) that returns a random colour from the palette for a user's avatar background, or null if the palette is empty. This is cosmetic (not security-sensitive).",
         code='''function randomAvatarColour(palette) {
  if (palette.length === 0) return null;
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = { randomAvatarColour };
''',
         visible_tests=JS_TEST_HDR + '''test('member', () => {
  const p = ['#f00', '#0f0'];
  assert.ok(p.includes(m.randomAvatarColour(p)));
});
''',
         hidden_tests=JS_TEST_HDR + '''test('empty', () => assert.strictEqual(m.randomAvatarColour([]), null));
test('single', () => assert.strictEqual(m.randomAvatarColour(['#abc']), '#abc'));
''',
         defect=None, explanation_gt="Correct. The insecure-random warning is a false positive for cosmetic use.",
         baseline_explanation="This function returns null for an empty palette and otherwise picks a random index with Math.random to choose one of the colours."),
    dict(id="JS-C2-02", language="javascript", cls="C2", block="B", split="eval",
         task="Write checksum(buffer) that returns a hex checksum used only to detect accidental file corruption during a local copy (not for security).",
         code='''const crypto = require('crypto');

function checksum(buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex');
}

module.exports = { checksum };
''',
         visible_tests=JS_TEST_HDR + '''test('deterministic', () => assert.strictEqual(m.checksum(Buffer.from('x')), m.checksum(Buffer.from('x'))));
test('length', () => assert.strictEqual(m.checksum(Buffer.from('x')).length, 32));
''',
         hidden_tests=JS_TEST_HDR + '''test('distinct', () => assert.notStrictEqual(m.checksum(Buffer.from('a')), m.checksum(Buffer.from('b'))));
test('empty', () => assert.strictEqual(m.checksum(Buffer.alloc(0)).length, 32));
''',
         defect=None, explanation_gt="Correct for accidental-corruption detection. The weak-hash warning is a false positive in this context.",
         baseline_explanation="This function uses Node's crypto module to compute an MD5 digest of the buffer and returns it as a hexadecimal string."),
    dict(id="JS-D1-01", language="javascript", cls="D1", block="A", split="eval",
         task="Write getProduct(db, id) that returns the product with the given id using a better-sqlite3 style db object (db.prepare(sql).get(...params)).",
         code='''function getProduct(db, id) {
  return db.prepare(`SELECT * FROM products WHERE id = ${id}`).get();
}

module.exports = { getProduct };
''',
         visible_tests=JS_TEST_HDR + '''test('returns row', () => {
  const db = { prepare: () => ({ get: () => ({ id: 1, name: 'pen' }) }) };
  assert.deepStrictEqual(m.getProduct(db, 1), { id: 1, name: 'pen' });
});
''',
         hidden_tests=JS_TEST_HDR + '''test('uses a placeholder, never interpolates input', () => {
  let sql = null; let params = null;
  const db = { prepare: (s) => { sql = s; return { get: (...p) => { params = p; return null; } }; } };
  m.getProduct(db, '1 OR 1=1');
  assert.ok(sql.includes('?') && !sql.includes('1 OR 1=1'));
  assert.deepStrictEqual(params, ['1 OR 1=1']);
});
''',
         defect="SQL injection (CWE-89): id is interpolated into the SQL text.",
         explanation_gt="Defective: must use a placeholder with a bound parameter.",
         baseline_explanation="This function prepares a SELECT statement for the requested product id and returns the matching row using the database's get method."),
    dict(id="JS-D1-02", language="javascript", cls="D1", block="B", split="eval",
         task="Write sum(numbers) that returns the sum of an array of numbers (0 for an empty array).",
         code='''function sum(numbers) {
  let total = 0;
  for (let i = 1; i < numbers.length; i++) {
    total += numbers[i];
  }
  return total;
}

module.exports = { sum };
''',
         visible_tests=JS_TEST_HDR + '''test('empty', () => assert.strictEqual(m.sum([]), 0));
test('three', () => assert.strictEqual(m.sum([1, 2, 3]), 6));
''',
         hidden_tests=JS_TEST_HDR + '''test('single', () => assert.strictEqual(m.sum([5]), 5));
''',
         defect="Loop starts at index 1, so the first element is skipped. The supplied test 'three' fails.",
         explanation_gt="Defective; detected by a supplied test.",
         baseline_explanation="This function iterates over the array, adding each number to a running total that starts at 0, and returns the total."),
    dict(id="JS-D2-01", language="javascript", cls="D2", block="A", split="eval",
         task="Write isPalindrome(text) that returns true if text reads the same forwards and backwards, ignoring case and any non-alphanumeric characters.",
         code='''function isPalindrome(text) {
  const s = text.toLowerCase();
  return s === s.split('').reverse().join('');
}

module.exports = { isPalindrome };
''',
         visible_tests=JS_TEST_HDR + '''test('simple', () => assert.strictEqual(m.isPalindrome('Racecar'), true));
test('not', () => assert.strictEqual(m.isPalindrome('hello'), false));
''',
         hidden_tests=JS_TEST_HDR + '''test('punctuation', () => assert.strictEqual(m.isPalindrome('A man, a plan, a canal: Panama'), true));
''',
         defect="Does not remove non-alphanumeric characters, contrary to the task.",
         explanation_gt="Defective for inputs with spaces or punctuation; outside the supplied tests and rules.",
         baseline_explanation="This function lower-cases the text and compares it with its reverse, returning true when they match."),
    dict(id="JS-D2-02", language="javascript", cls="D2", block="B", split="eval",
         task="Write countWords(text) that returns the number of words in text, where words are separated by any amount of whitespace (0 for empty or blank text).",
         code='''function countWords(text) {
  return text.split(' ').length;
}

module.exports = { countWords };
''',
         visible_tests=JS_TEST_HDR + '''test('two', () => assert.strictEqual(m.countWords('hello world'), 2));
test('three', () => assert.strictEqual(m.countWords('a b c'), 3));
''',
         hidden_tests=JS_TEST_HDR + '''test('empty', () => assert.strictEqual(m.countWords(''), 0));
test('multiple spaces', () => assert.strictEqual(m.countWords('a  b'), 2));
''',
         defect="Returns 1 for an empty string and over-counts when words are separated by multiple spaces.",
         explanation_gt="Defective for blank input and repeated whitespace; outside supplied tests and rules.",
         baseline_explanation="This function splits the text on spaces and returns the number of resulting words."),
    # ============================ DEV / PRACTICE ============================
    dict(id="PY-C1-D1", language="python", cls="C1", block=None, split="dev",
         task="Write factorial(n) for integers n >= 0.",
         code='''def factorial(n):
    result = 1
    for k in range(2, n + 1):
        result *= k
    return result
''',
         visible_tests=PY_TEST_HDR + "def test_five():\n    assert factorial(5) == 120\n",
         hidden_tests=PY_TEST_HDR + "def test_zero():\n    assert factorial(0) == 1\n\ndef test_one():\n    assert factorial(1) == 1\n",
         defect=None, explanation_gt="Correct.",
         baseline_explanation="This function multiplies the integers from 2 up to n to compute n factorial, returning 1 for 0 and 1."),
    dict(id="JS-D1-D1", language="javascript", cls="D1", block=None, split="dev",
         task="Write calculate(expression) that evaluates a simple arithmetic expression typed by a user, such as '2 + 3 * 4'.",
         code='''function calculate(expression) {
  return eval(expression);
}

module.exports = { calculate };
''',
         visible_tests=JS_TEST_HDR + "test('arith', () => assert.strictEqual(m.calculate('2 + 3 * 4'), 14));\n",
         hidden_tests=JS_TEST_HDR + "test('does not execute code', () => { try { m.calculate('globalThis.pwned = 1'); } catch (e) {} assert.strictEqual(globalThis.pwned, undefined); });\n",
         defect="eval executes arbitrary user-supplied code (CWE-95).",
         explanation_gt="Defective: arbitrary code execution.",
         baseline_explanation="This function evaluates the arithmetic expression and returns the numeric result."),
    dict(id="PY-D2-D1", language="python", cls="D2", block=None, split="dev",
         task="Write chunk(items, size) that splits a list into consecutive chunks of length size; the last chunk may be shorter.",
         code='''def chunk(items, size):
    return [items[i:i + size] for i in range(0, len(items) - size + 1, size)]
''',
         visible_tests=PY_TEST_HDR + "def test_even():\n    assert chunk([1, 2, 3, 4], 2) == [[1, 2], [3, 4]]\n",
         hidden_tests=PY_TEST_HDR + "def test_remainder():\n    assert chunk([1, 2, 3], 2) == [[1, 2], [3]]\n",
         defect="Drops the final partial chunk.",
         explanation_gt="Defective when len(items) is not a multiple of size.",
         baseline_explanation="This function walks through the list in steps of size and collects each slice as a chunk."),
    dict(id="JS-C2-D1", language="javascript", cls="C2", block=None, split="dev",
         task="Write retryDelay(attempt) that returns an exponential back-off delay in ms (100 * 2^attempt) plus up to 50 ms of random jitter, to avoid synchronised retries (not security-sensitive).",
         code='''function retryDelay(attempt) {
  return 100 * 2 ** attempt + Math.floor(Math.random() * 50);
}

module.exports = { retryDelay };
''',
         visible_tests=JS_TEST_HDR + "test('range', () => { const d = m.retryDelay(1); assert.ok(d >= 200 && d < 250); });\n",
         hidden_tests=JS_TEST_HDR + "test('zero', () => { const d = m.retryDelay(0); assert.ok(d >= 100 && d < 150); });\n",
         defect=None, explanation_gt="Correct; insecure-random warning is a false positive for jitter.",
         baseline_explanation="This function doubles a 100 ms base delay for each attempt and adds a small random jitter."),
]
