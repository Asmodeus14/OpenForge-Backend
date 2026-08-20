# Contributing

## Setting up

```bash
npm install
cp .env.example .env     # fill in DATABASE_URL, JWT_SECRET, CORS_ORIGIN
npm run migrate          # apply migrations in order
npm run dev              # nodemon on PORT (default 5164)
```

Generate a real `JWT_SECRET`. Never reuse one from an example file:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`CORS_ORIGIN` is a comma-separated list and **every entry needs its scheme**.
`localhost:3000` matches nothing; `http://localhost:3000` matches. The server
warns at startup about entries missing a scheme, and logs every refused origin,
because this failure is otherwise indistinguishable from the server being down
— a rejected origin still gets a normal `200`, and only the browser discards it.

## Migrations

Migrations live in `src/db/migrations/`, are applied in filename order, and are
tracked by filename rather than by content hash. Editing an applied migration
therefore does not re-run it — that is intentional, so comments can be
corrected, but it means a schema change needs a **new** file.

Write them so they can be run twice: `CREATE INDEX IF NOT EXISTS`, and so on.

## House style

**Comments explain why, not what.** The valuable comment is the one recording
what is not visible in the code — the measurement behind a change, the failure
being guarded against, the reason the obvious approach was rejected.

**Count round trips, not queries.** Every query here executes in well under
2ms, while a round trip to the database costs around 90ms. `SELECT 1` costs the
same as real work. That means the useful optimisation is nearly always issuing
fewer round trips — `Promise.all` over independent reads, or one query instead
of two — and almost never rewriting a query that was already fast.

**Do not report data the database did not give you.** A field named `liked_by`
must be the list of people who liked it. Synthesising a plausible value is
worse than omitting the field, because callers cannot tell the difference.

**Watch the route mount order.** `/api/rooms` is mounted before `/api`, so a
path defined in `routes/rooms.js` shadows the same path in `routes/messages.js`
and the second one silently never runs. Check before adding a route that could
collide.

## Before opening a pull request

There is no test runner. At minimum:

- The server starts clean and `/health` returns `healthy`.
- Any changed endpoint has been exercised against a real database.
- New queries have been run, not just written — a lateral join can be
  syntactically valid and still wrong.

## Reporting bugs

Open an issue with the request, the response and what you expected. For
anything exploitable, see [SECURITY.md](SECURITY.md) instead.

Participation is covered by our [Code of Conduct](CODE_OF_CONDUCT.md).
