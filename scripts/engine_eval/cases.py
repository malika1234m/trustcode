"""Labelled cases for measuring the verification engine's detection accuracy (static checks only).

Each case: id, lang, category, defective (ground truth), code, and `expect`: rule ids / check kinds any of
which counts as detecting *the labelled defect* (None = no static check is expected to see it; kept in the
set on purpose so that recall is not inflated).

Labels are author-defined (LLM-assisted) and have NOT been independently reviewed. The set is small and was
written by the same author as the rules, so the numbers are an internal regression signal, not an estimate
of real-world accuracy. See docs/testing/engine_accuracy.md.
"""

# Synthetic credential-shaped values are assembled at import time, so no secret-format literal is stored in the
# repository (secret scanners and push protection would otherwise flag these fixtures). None is a real credential.
_FAKE = {
    "@@GITHUB@@": "gh" + "p_" + "R4nd0mLookingT0kenValue1234567890abcd",
    "@@STRIPE@@": "sk" + "_live_" + "4eC39HqLyjWDarjtT1zdp7dcXyZ",
    "@@AWS@@": "AK" + "IA" + "Q3EGRT7WXYZ12ABC",
    "@@AWS_DOC_EXAMPLE@@": "AK" + "IA" + "IOSFODNN7" + "EXAMPLE",
    "@@PEM_BEGIN@@": "-----BEGIN RSA " + "PRIVATE KEY-----",
    "@@PEM_END@@": "-----END RSA " + "PRIVATE KEY-----",
    "@@DB_URL@@": "postgresql://admin:" + "S3cr3tPassw0rd" + "@db.internal:5432/prod",
}


def case(id, lang, category, defective, code, expect=None, note=""):
    for marker, value in _FAKE.items():
        code = code.replace(marker, value)
    return {"id": id, "lang": lang, "category": category, "defective": defective, "code": code.lstrip("\n"),
            "expect": expect, "note": note}


CASES = [
    # ------------------------------------------------------------------ correct code
    case("OK-PY-01", "python", "correct", False, '''
def average(values):
    if not values:
        return 0.0
    return sum(values) / len(values)
'''),
    case("OK-PY-02", "python", "correct", False, '''
def find_user(conn, username):
    cur = conn.execute("SELECT id, username FROM users WHERE username = ?", (username,))
    return cur.fetchone()
'''),
    case("OK-PY-03", "python", "correct", False, '''
import subprocess


def list_dir(path):
    return subprocess.run(["ls", "-l", path], capture_output=True, text=True, check=True).stdout
'''),
    case("OK-PY-04", "python", "correct", False, '''
import hashlib


def file_checksum(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
'''),
    case("OK-PY-05", "python", "correct", False, '''
import os


def api_key() -> str:
    key = os.environ.get("SERVICE_API_KEY")
    if not key:
        raise RuntimeError("SERVICE_API_KEY is not set")
    return key
'''),
    case("OK-PY-06", "python", "correct", False, '''
from dataclasses import dataclass, field


@dataclass
class Cart:
    items: list[str] = field(default_factory=list)

    def add(self, item: str) -> int:
        self.items.append(item)
        return len(self.items)
'''),
    case("OK-PY-07", "python", "correct", False, '''
import random


def shuffle_questions(questions):
    """Return the quiz questions in a random order (not security sensitive)."""
    result = list(questions)
    random.shuffle(result)
    return result
''', note="non-security use of random: a classic false-alarm trap"),
    case("OK-PY-08", "python", "correct", False, '''
import json


def load_config(text: str) -> dict:
    data = json.loads(text)
    if not isinstance(data, dict):
        raise ValueError("config must be an object")
    return data
'''),
    case("OK-JS-01", "javascript", "correct", False, '''
function isPalindrome(text) {
  const clean = text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return clean === clean.split('').reverse().join('');
}
module.exports = { isPalindrome };
'''),
    case("OK-JS-02", "javascript", "correct", False, '''
const { execFile } = require('child_process');

function gitStatus(dir, cb) {
  execFile('git', ['status', '--short'], { cwd: dir }, (err, stdout) => cb(err, stdout));
}
module.exports = { gitStatus };
'''),
    case("OK-JS-03", "javascript", "correct", False, '''
async function findUser(db, name) {
  const rows = await db.query('SELECT id, name FROM users WHERE name = $1', [name]);
  return rows[0] ?? null;
}
module.exports = { findUser };
'''),
    case("OK-JS-04", "javascript", "correct", False, '''
function setLabel(el, text) {
  el.textContent = text;
  return el;
}
module.exports = { setLabel };
'''),
    case("OK-JS-05", "javascript", "correct", False, '''
const crypto = require('crypto');

function newSessionId() {
  return crypto.randomBytes(32).toString('hex');
}
module.exports = { newSessionId };
'''),
    case("OK-TS-01", "typescript", "correct", False, '''
interface User { id: number; name: string }

export function byId(users: User[], id: number): User | undefined {
  return users.find((u) => u.id === id);
}
'''),
    case("OK-TS-02", "typescript", "correct", False, '''
import type { Request } from 'express';

export function clientIp(req: Request): string {
  return req.ip ?? 'unknown';
}
'''),
    case("OK-TS-03", "typescript", "correct", False, '''
export enum Level { Low = 'low', High = 'high' }

export function rank(level: Level): number {
  switch (level) {
    case Level.Low: return 1;
    case Level.High: return 2;
  }
}
'''),

    # ------------------------------------------------------------------ valid but unusual
    case("UN-PY-01", "python", "unusual_valid", False, '''
def first_long(words, n):
    for w in words:
        if (size := len(w)) > n:
            return w, size
    else:
        return None, 0
'''),
    case("UN-PY-02", "python", "unusual_valid", False, '''
def describe(shape):
    match shape:
        case {"kind": "circle", "r": r}:
            return 3.14159 * r * r
        case {"kind": "rect", "w": w, "h": h}:
            return w * h
        case _:
            raise ValueError("unknown shape")
'''),
    case("UN-PY-03", "python", "unusual_valid", False, '''
def make_counters(n):
    return [lambda i=i: i * 2 for i in range(n)]
'''),
    case("UN-PY-04", "python", "unusual_valid", False, '''
def read_all(path):
    try:
        fh = open(path)
    except FileNotFoundError:
        return ""
    else:
        with fh:
            return fh.read()
    finally:
        print("read_all finished")
'''),
    case("UN-JS-01", "javascript", "unusual_valid", False, '''
function allMatches(re, text) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[0]);
  }
  return out;
}
module.exports = { allMatches };
'''),
    case("UN-JS-02", "javascript", "unusual_valid", False, '''
function firstPair(grid, target) {
  outer: for (let i = 0; i < grid.length; i++) {
    for (let j = 0; j < grid[i].length; j++) {
      if (grid[i][j] === target) { return [i, j]; }
      if (grid[i][j] > target) { continue outer; }
    }
  }
  return void 0;
}
module.exports = { firstPair };
'''),
    case("UN-JS-03", "javascript", "unusual_valid", False, '''
const temperature = {
  _c: 0,
  get celsius() { return this._c; },
  set celsius(v) { this._c = Number(v); },
};
module.exports = { temperature };
'''),
    case("UN-JS-04", "javascript", "unusual_valid", False, '''
function parse(text) {
  let value;
  if ((value = Number(text)) || value === 0) {
    return value;
  }
  return null;
}
module.exports = { parse };
''', note="intentional assignment in a condition, wrapped in extra parentheses"),
    case("UN-TS-01", "typescript", "unusual_valid", False, '''
export function assertNever(x: never): never {
  throw new Error(`unexpected: ${String(x)}`);
}

export type DeepReadonly<T> = { readonly [K in keyof T]: T[K] extends object ? DeepReadonly<T[K]> : T[K] };
'''),

    # ------------------------------------------------------------------ syntax errors
    case("SYN-PY-01", "python", "syntax_error", True, '''
def total(items)
    return sum(items)
''', expect=["syntax-error"]),
    case("SYN-PY-02", "python", "syntax_error", True, '''
def greet(name):
    print("hello, " + name
    return name
''', expect=["syntax-error"]),
    case("SYN-PY-03", "python", "syntax_error", True, '''
def pick(xs):
    if xs:
        return xs[0]
      return None
''', expect=["syntax-error"]),
    case("SYN-JS-01", "javascript", "syntax_error", True, '''
function total(items) {
  return items.reduce((a, b) => a + b, 0;
}
''', expect=["syntax-error"]),
    case("SYN-JS-02", "javascript", "syntax_error", True, '''
export function load(path) {
  const data = await fetch(path)
  return data.json(
}
''', expect=["syntax-error"]),
    case("SYN-TS-01", "typescript", "syntax_error", True, '''
export function area(w: number, h: number): number {
  return w * h;
''', expect=["syntax-error"]),

    # ------------------------------------------------------------------ security vulnerabilities
    case("SEC-PY-01", "python", "security", True, '''
def find_user(conn, username):
    query = f"SELECT id, username FROM users WHERE username = '{username}'"
    return conn.execute(query).fetchone()
''', expect=["sql-string-formatting"]),
    case("SEC-PY-02", "python", "security", True, '''
import os


def ping(host):
    return os.system("ping -c 1 " + host)
''', expect=["shell-command-injection"]),
    case("SEC-PY-03", "python", "security", True, '''
import subprocess


def archive(name):
    subprocess.run(f"tar czf backup.tgz {name}", shell=True, check=True)
''', expect=["shell-command-injection"]),
    case("SEC-PY-04", "python", "security", True, '''
def calculate(expression):
    return eval(expression)
''', expect=["eval-exec-use"]),
    case("SEC-PY-05", "python", "security", True, '''
import pickle


def load_session(blob):
    return pickle.loads(blob)
''', expect=["unsafe-deserialization"]),
    case("SEC-PY-06", "python", "security", True, '''
import hashlib


def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()
''', expect=["weak-password-hash"]),
    case("SEC-PY-07", "python", "security", True, '''
import requests


def fetch(url):
    return requests.get(url, verify=False, timeout=10).text
''', expect=["tls-verification-disabled"]),
    case("SEC-PY-08", "python", "security", True, '''
import os


def read_upload(filename):
    with open(os.path.join("/srv/uploads", filename)) as fh:
        return fh.read()
''', expect=["path-traversal-open"]),
    case("SEC-PY-09", "python", "security", True, '''
import yaml


def parse(text):
    return yaml.load(text, Loader=yaml.Loader)
''', expect=["unsafe-deserialization"], note="unsafe YAML loader"),
    case("SEC-PY-10", "python", "security", True, '''
import requests


def preview(url):
    """Fetch any URL the user supplies and return the body."""
    return requests.get(url, timeout=5).text
''', expect=None, note="SSRF: needs data-flow / intent knowledge; no rule"),
    case("SEC-PY-11", "python", "security", True, '''
import secrets_store
import random


def reset_token():
    return "".join(random.choice("abcdef0123456789") for _ in range(32))
''', expect=["insecure-random"], note="security token from a non-cryptographic PRNG"),
    case("SEC-JS-01", "javascript", "security", True, '''
async function findUser(db, name) {
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}
module.exports = { findUser };
''', expect=["js-sql-concat", "js-sql-concat-any-position"]),
    case("SEC-JS-02", "javascript", "security", True, '''
const { exec } = require('child_process');

function ping(host, cb) {
  exec('ping -c 1 ' + host, cb);
}
module.exports = { ping };
''', expect=["js-child-process-exec"]),
    case("SEC-JS-03", "javascript", "security", True, '''
function render(el, comment) {
  el.innerHTML = '<p>' + comment + '</p>';
}
module.exports = { render };
''', expect=["js-innerhtml"]),
    case("SEC-JS-04", "javascript", "security", True, '''
function run(userCode) {
  return eval(userCode);
}
module.exports = { run };
''', expect=["js-eval"]),
    case("SEC-JS-05", "javascript", "security", True, '''
function merge(target, source) {
  for (const key in source) {
    if (typeof source[key] === 'object') {
      target[key] = merge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}
module.exports = { merge };
''', expect=["js-prototype-pollution-merge"]),
    case("SEC-TS-01", "typescript", "security", True, '''
import { createHash } from 'crypto';

export function hashPassword(password: string): string {
  return createHash('md5').update(password).digest('hex');
}
''', expect=["js-weak-hash"]),
    case("SEC-JS-06", "javascript", "security", True, '''
const jwt = require('jsonwebtoken');

function readToken(token) {
  return jwt.decode(token);
}
module.exports = { readToken };
''', expect=None, note="JWT decoded without signature verification; no rule"),

    # ------------------------------------------------------------------ hardcoded secrets
    case("SCR-PY-01", "python", "secret", True, '''
import requests

GITHUB_TOKEN = "@@GITHUB@@"


def repos():
    return requests.get("https://api.github.com/user/repos", headers={"Authorization": f"token {GITHUB_TOKEN}"}, timeout=10).json()
''', expect=["github-token", "hardcoded-secret"]),
    case("SCR-PY-02", "python", "secret", True, '''
import psycopg2


def connect():
    return psycopg2.connect("@@DB_URL@@")
''', expect=["credentials-in-url"]),
    case("SCR-PY-03", "python", "secret", True, '''
DB_PASSWORD = "correct-horse-battery"


def dsn(host):
    return {"host": host, "user": "app", "password": DB_PASSWORD}
''', expect=["hardcoded-secret"]),
    case("SCR-JS-01", "javascript", "secret", True, '''
const stripe = require('stripe')('@@STRIPE@@');

async function charge(amount) {
  return stripe.charges.create({ amount, currency: 'usd' });
}
module.exports = { charge };
''', expect=["stripe-live-key", "js-hardcoded-secret"]),
    case("SCR-JS-02", "javascript", "secret", True, '''
const PRIVATE_KEY = `@@PEM_BEGIN@@
MIIBOgIBAAJBAKj34GkxFhD90vcNLYLInFEX6Ppy1tPf9Cnzj4p4WGeKLs1Pt8Qu
@@PEM_END@@`;

module.exports = { PRIVATE_KEY };
''', expect=["private-key-block"]),
    case("SCR-TS-01", "typescript", "secret", True, '''
export const config = {
  region: 'eu-west-1',
  accessKeyId: '@@AWS@@',
};
''', expect=["aws-access-key-id"]),

    # ------------------------------------------------------------------ logic errors
    case("LOG-PY-01", "python", "logic_error", True, '''
def average(values):
    return sum(values) / len(values)
''', expect=None, note="ZeroDivisionError on empty list; needs a test"),
    case("LOG-PY-02", "python", "logic_error", True, '''
def last_n(items, n):
    return items[len(items) - n + 1:]
''', expect=None, note="off-by-one"),
    case("LOG-PY-03", "python", "logic_error", True, '''
def is_adult(age):
    return age > 18
''', expect=None, note="boundary: 18 should be adult"),
    case("LOG-PY-04", "python", "logic_error", True, '''
def add_tag(tag, tags=[]):
    tags.append(tag)
    return tags
''', expect=["B006"]),
    case("LOG-PY-05", "python", "logic_error", True, '''
def safe_div(a, b):
    try:
        return a / b
    except ZeroDivisionError:
        return 0
    finally:
        return -1
''', expect=["B012"], note="return in finally overrides every other return"),
    case("LOG-PY-06", "python", "logic_error", True, '''
def build_handlers(names):
    handlers = []
    for name in names:
        handlers.append(lambda: print(name))
    return handlers
''', expect=["B023"], note="late-binding closure"),
    case("LOG-JS-01", "javascript", "logic_error", True, '''
function isMissing(value) {
  return value === NaN;
}
module.exports = { isMissing };
''', expect=["nan-comparison"]),
    case("LOG-JS-02", "javascript", "logic_error", True, '''
function grant(user) {
  if (user.role = 'admin') {
    return true;
  }
  return false;
}
module.exports = { grant };
''', expect=["assignment-in-condition"]),
    case("LOG-JS-03", "javascript", "logic_error", True, '''
function sumTo(n) {
  let total = 0;
  for (let i = 0; i <= n.length; i++) {
    total += n[i];
  }
  return total;
}
module.exports = { sumTo };
''', expect=None, note="off-by-one reads undefined"),
    case("LOG-JS-04", "javascript", "logic_error", True, '''
function sortNumbers(xs) {
  return xs.sort();
}
module.exports = { sortNumbers };
''', expect=None, note="lexicographic sort of numbers"),
    case("LOG-TS-01", "typescript", "logic_error", True, '''
export function statusText(code: number): string {
  switch (code) {
    case 200: return 'ok';
    case 404: return 'not found';
    case 200: return 'created';
    default: return 'unknown';
  }
}
''', expect=["duplicate-case"]),

    # ------------------------------------------------------------------ missing / hallucinated dependencies
    case("DEP-PY-01", "python", "missing_dependency", True, '''
from fastjsonvalidatorx import validate_schema


def check(doc, schema):
    return validate_schema(doc, schema)
''', expect=["package-not-found"], note="hallucinated package; needs the registry lookup"),
    case("DEP-JS-01", "javascript", "missing_dependency", True, '''
const { deepEqualFast } = require('lodash-deep-equal-fastest-x');

module.exports = (a, b) => deepEqualFast(a, b);
''', expect=["package-not-found"], note="hallucinated package; needs the registry lookup"),
    case("DEP-PY-02", "python", "missing_dependency", True, '''
def slugify(title):
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
''', expect=["F821"], note="uses `re` without importing it"),
    case("DEP-JS-02", "javascript", "missing_dependency", True, '''
function readConfig(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
module.exports = { readConfig };
''', expect=None, note="uses `fs` without requiring it; JS undefined names are not checked"),

    # ------------------------------------------------------------------ AI-style subtle defects
    case("AI-PY-01", "python", "ai_subtle", True, '''
def normalise(scores):
    top = max(scores)
    return [round_half_up(s / top, 2) for s in scores]
''', expect=["F821"], note="calls a helper that does not exist"),
    case("AI-PY-02", "python", "ai_subtle", True, '''
def parse_port(value: str) -> int:
    if value.isdigit():
        return int(value)
    return value
''', expect=["return-value"], note="returns str where int is declared"),
    case("AI-PY-03", "python", "ai_subtle", True, '''
def label(count: int) -> str:
    return "items: " + count
''', expect=["operator"], note="str + int"),
    case("AI-PY-04", "python", "ai_subtle", True, '''
PRICES = {"basic": 5, "pro": 20, "basic": 9}


def price(plan):
    return PRICES[plan]
''', expect=["F601"], note="duplicate dict key"),
    case("AI-PY-05", "python", "ai_subtle", True, '''
def save(record, db):
    try:
        db.insert(record)
        db.commit()
    except:
        pass
    return True
''', expect=["S110", "E722"], note="reports success even when the write failed"),
    case("AI-PY-06", "python", "ai_subtle", True, '''
def clamp(value: float, low: float, high: float) -> float:
    if value < low:
        return low
    if value > high:
        return high
''', expect=["return"], note="missing final return -> None"),
    case("AI-PY-07", "python", "ai_subtle", True, '''
import asyncio


async def fetch_all(client, urls):
    results = []
    for url in urls:
        results.append(client.get(url))
    return results
''', expect=None, note="missing await: returns coroutines"),
    case("AI-JS-01", "javascript", "ai_subtle", True, '''
const DEFAULTS = { retries: 3, timeout: 1000, retries: 5 };

function options(overrides) {
  return { ...DEFAULTS, ...overrides };
}
module.exports = { options };
''', expect=["duplicate-object-key"]),
    case("AI-JS-02", "javascript", "ai_subtle", True, '''
function validate(order) {
  if (!order.items.length) {
    throw new Error('empty order');
    return false;
  }
  return true;
  order.validated = true;
}
module.exports = { validate };
''', expect=["unreachable-code"]),
    case("AI-JS-03", "javascript", "ai_subtle", True, '''
const MAX_RETRIES = 3;

function backoff(attempt) {
  if (attempt > MAX_RETRIES) {
    MAX_RETRIES = attempt;
  }
  return 100 * 2 ** attempt;
}
module.exports = { backoff };
''', expect=["const-reassignment"]),
    case("AI-JS-04", "javascript", "ai_subtle", True, '''
async function saveAll(db, records) {
  records.forEach(async (r) => {
    await db.save(r);
  });
  return 'saved';
}
module.exports = { saveAll };
''', expect=None, note="forEach does not await; returns before the writes finish"),
    case("AI-TS-01", "typescript", "ai_subtle", True, '''
export function total(prices: number[]): number {
  let sum = 0;
  for (const p of prices) {
    sum = sum;
  }
  return sum;
}
''', expect=["self-assignment"]),
    case("AI-TS-02", "typescript", "ai_subtle", True, '''
export function parseAge(input: string): number {
  const age: number = input;
  return age;
}
''', expect=None, note="type error; no TypeScript type checker is bundled"),

    # ------------------------------------------------------------------ edge cases for the engine itself
    case("EDGE-PY-01", "python", "edge_case", False, ''),
    case("EDGE-PY-02", "python", "edge_case", False, '''
# only a comment
'''),
    case("EDGE-PY-03", "python", "edge_case", False, '''
def greet(name):
    return f"Привет, {name} 👋"
'''),
    case("EDGE-JS-01", "javascript", "edge_case", False, '''
// docs: connect with postgres://user:password@localhost/db (replace with your own values)
function dsn(env) {
  return env.DATABASE_URL;
}
module.exports = { dsn };
''', note="placeholder credentials in a comment must not be reported"),
    case("EDGE-PY-04", "python", "edge_case", False, '''
AWS_EXAMPLE_KEY_ID = "@@AWS_DOC_EXAMPLE@@"  # the documented AWS example key, not a real credential
''', note="documented example key"),
    case("EDGE-TS-01", "typescript", "edge_case", False, '''
declare module 'config' {
  export interface Settings { port: number; host?: string }
  export function load(path: string): Settings;
}
'''),
]
