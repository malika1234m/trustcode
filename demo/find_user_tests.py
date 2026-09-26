from solution import *
import sqlite3

def _db():
    c = sqlite3.connect(":memory:")
    c.execute("CREATE TABLE users (id INTEGER, username TEXT)")
    c.execute("INSERT INTO users VALUES (1, 'alice')")
    return c

def test_found():
    assert find_user(_db(), "alice") == (1, "alice")

def test_missing():
    assert find_user(_db(), "bob") is None
