"""Reference for atomic ticket spending; NOT an authenticated LAN server.
Only invoke issue/place from trusted application code after authentication/validation.
Window scheduling, authorization, TLS, refunds and native adapters are production tasks.
"""
from __future__ import annotations
from contextlib import closing
import hashlib
import json
import sqlite3
import time
import uuid
from pathlib import Path

DDL='''
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS grants (
 guest TEXT NOT NULL, window_id TEXT NOT NULL, policy_version TEXT NOT NULL,
 quota INTEGER NOT NULL CHECK(quota>=0), spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0),
 starts REAL NOT NULL, expires REAL NOT NULL CHECK(expires>starts),
 PRIMARY KEY(guest,window_id,policy_version), CHECK(spent<=quota)
);
CREATE TABLE IF NOT EXISTS orders (
 id TEXT PRIMARY KEY, guest TEXT NOT NULL, request_id TEXT NOT NULL,
 request_hash TEXT NOT NULL, snapshot_json TEXT NOT NULL,
 window_id TEXT NOT NULL, policy_version TEXT NOT NULL,
 created REAL NOT NULL, status TEXT NOT NULL DEFAULT 'received',
 UNIQUE(guest,request_id)
);
CREATE TABLE IF NOT EXISTS outbox (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT UNIQUE NOT NULL,
 event_json TEXT NOT NULL
);
'''

class TicketStore:
    def __init__(self, path: str | Path):
        self.path = str(path)
        with closing(self.connect()) as c:
            c.executescript(DDL)

    def connect(self):
        c=sqlite3.connect(self.path, timeout=10, isolation_level=None)
        c.row_factory=sqlite3.Row
        c.execute('PRAGMA busy_timeout=10000')
        return c

    def issue(self, guest: str, window_id: str, policy: str, quota: int,
              starts: float, expires: float):
        if not guest or not window_id or not policy or isinstance(quota,bool) or not isinstance(quota,int) or quota<0:
            raise ValueError('Invalid grant.')
        if expires<=starts:
            raise ValueError('Invalid grant window.')
        # Reconnecting must not replenish today's grant.
        with closing(self.connect()) as c:
            c.execute('INSERT OR IGNORE INTO grants(guest,window_id,policy_version,quota,starts,expires) VALUES(?,?,?,?,?,?)',
                      (guest,window_id,policy,quota,starts,expires))

    def place(self, guest: str, request_id: str, window_id: str, policy: str,
              validated_snapshot: dict, now: float | None = None):
        if not guest or not request_id or not isinstance(validated_snapshot,dict) or not validated_snapshot:
            raise ValueError('Missing authenticated identity, idempotency key or validated snapshot.')
        now = time.time() if now is None else now
        # JSON serialization also rejects NaN and Infinity; snapshot cannot mutate afterwards.
        snapshot=json.dumps(validated_snapshot,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        raw=json.dumps([window_id,policy,validated_snapshot],sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
        h=hashlib.sha256(raw.encode()).hexdigest()
        c=self.connect()
        try:
            c.execute('BEGIN IMMEDIATE')
            prior=c.execute('SELECT * FROM orders WHERE guest=? AND request_id=?',(guest,request_id)).fetchone()
            if prior:
                if prior['request_hash']!=h:
                    raise ValueError('IDEMPOTENCY_CONFLICT')
                c.commit()
                return dict(prior)
            row=c.execute('SELECT * FROM grants WHERE guest=? AND window_id=? AND policy_version=?',
                          (guest,window_id,policy)).fetchone()
            if row is None or not row['starts']<=now<row['expires'] or row['spent']>=row['quota']:
                raise ValueError('NO_VALID_TICKET')
            oid=str(uuid.uuid4())
            c.execute('UPDATE grants SET spent=spent+1 WHERE guest=? AND window_id=? AND policy_version=?',
                      (guest,window_id,policy))
            c.execute('INSERT INTO orders(id,guest,request_id,request_hash,snapshot_json,window_id,policy_version,created) VALUES(?,?,?,?,?,?,?,?)',
                      (oid,guest,request_id,h,snapshot,window_id,policy,now))
            c.execute('INSERT INTO outbox(order_id,event_json) VALUES(?,?)',
                      (oid,json.dumps({'type':'order.received','order_id':oid,'guest':guest})))
            result=dict(c.execute('SELECT * FROM orders WHERE id=?',(oid,)).fetchone())
            c.commit()
            return result
        except Exception:
            c.rollback()
            raise
        finally:
            c.close()
