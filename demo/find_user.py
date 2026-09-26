# TrustCode demo (PY-D1-01). Task: Write find_user(conn, username) that returns the row for the given username from the 'users' table of a sqlite3 connection, or None.
# Select the code below and run: TrustCode: Verify Selected Code

def find_user(conn, username):
    query = f"SELECT id, username FROM users WHERE username = '{username}'"
    return conn.execute(query).fetchone()
