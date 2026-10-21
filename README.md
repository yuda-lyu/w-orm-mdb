# w-orm-mdb
An operator for access mdb database in nodejs.

![language](https://img.shields.io/badge/language-JavaScript-orange.svg) 
[![npm version](http://img.shields.io/npm/v/w-orm-mdb.svg?style=flat)](https://npmjs.org/package/w-orm-mdb) 
[![license](https://img.shields.io/npm/l/w-orm-mdb.svg?style=flat)](https://npmjs.org/package/w-orm-mdb) 
[![npm download](https://img.shields.io/npm/dt/w-orm-mdb.svg)](https://npmjs.org/package/w-orm-mdb) 
[![npm download](https://img.shields.io/npm/dm/w-orm-mdb.svg)](https://npmjs.org/package/w-orm-mdb) 
[![jsdelivr download](https://img.shields.io/jsdelivr/npm/hm/w-orm-mdb.svg)](https://www.jsdelivr.com/package/npm/w-orm-mdb)

## Documentation
To view documentation or get support, visit [docs](https://yuda-lyu.github.io/w-orm-mdb/WOrm.html).

## Installation

### Using npm(ES6 module):
```alias
npm i w-orm-mdb
```

> **Zero-install requirement:** Runs on Windows only. The package operates mdb files through the bundled `connMDB.exe`, which uses the Windows built-in Jet 4.0 engine and built-in .NET Framework 4.x — no need to install AccessDatabaseEngine, Java or any SDK. Supports `.mdb` (Jet4, Access 2000-2003 format, max 2GB) including password-protected files; `.accdb` is not supported.

### Condition (`find`) whitelist for `select` and `delAll`

`select(find)` and `delAll(find)` accept the same series wide whitelist (shared with the other `w-orm-*` packages through `cvOrmFind` of `wsemi`) and filter through one code path, so **the rows `delAll` deletes are exactly the rows `select` returns** for the same `find`. Anything outside the whitelist **rejects as a whole** (and emits `error`) before the model files are loaded, before the mdb file is opened and before any SQL is sent: nothing is ignored, reinterpreted or deleted. (The checks of the next paragraph, column names and value types against the model, run after the table has been read; they reject as a whole too and delete nothing.) The error message is `invalid find: <reason> at [<path>]`; the shared whitelist check never echoes the offending value (the column type check described below may quote it).

| Form | Meaning |
|---|---|
| `find` omitted, `undefined` or `{}` | all rows (for `delAll`: **every row is deleted**, see below) |
| `{ col: value }` | equality; several columns are combined with AND; the value is a string (no NUL, no lone surrogate), a finite number, a boolean, a valid `Date`, or `null` (`IS NULL`) |
| `$eq` `$ne` `$gt` `$gte` `$lt` `$lte` | comparison with a scalar (`null` only for `$eq` / `$ne`); several operators on one column are combined with AND |
| `$in` `$nin` | an array of scalars (no `null`), **at most 2000 values** (and at most 2000 distinct primary key values in the whole `find`); `$in: []` matches nothing, `$nin: []` rejects |
| `$and` `$or` | a non empty array of non empty condition objects, **at most 999 items** (the in memory filter runs on SQLite, which fails at 1000 flat items) |

Limits: nesting depth 32, `$in` / `$nin` at most 2000 values (Jet decides every primary key value one statement at a time, about 1.6 ms each, so 2000 values already take a few seconds; the same limit holds for the number of distinct primary key values in the whole `find`, spread over several arrays inside `$or` / `$and` or not, and a `find` over it rejects with `too many primary key values (> 2000)` after the table has been read and before Jet is asked about any key), at most 100000 nodes, column names of 1 to 128 characters matching `^[\p{L}_][\p{L}\p{M}\p{N}_]*$` (so no dots, quotes, hyphens, spaces or a leading `$`; Chinese letters are fine).

Everything else rejects, among them: a `find` that is not a plain condition object (`null`, an array, a string, a number, a boolean, a function, a `Date`, a `RegExp`, a `Map`, a class instance …, which are **never** treated as `{}`), `$not` `$nor` `$regex` `$options` `$exists` `$where` `$expr` `$like` `$ilike` and any other operator, `$and` / `$or` inside a column, sequelize `Op` symbols, a `RegExp` value, an array as a column value (write `$in`), `undefined`, functions, symbols, `BigInt`, `Buffer`, `NaN`, `±Infinity`, invalid `Date` and `String` / `Number` wrapper objects as values, symbol keys, getters and non enumerable keys, sparse arrays or arrays with extra properties, empty operator objects, empty `$and` / `$or` or a `{}` inside them.

On top of the whitelist the rows are filtered in memory through the model (`w-orm-reladb`), which rejects what cannot be translated with its meaning intact (an empty table cannot show which columns exist, so there a column that the model lists but the table lacks is only rejected once the table has rows): values that do not fit the column type (for example `'abc'` against a numeric column, or a date string without a time such as `'2026-01-01'`; a date-time string without a zone is taken as the wall-clock time it states, as Jet stores no zone; a `Date`, an epoch number or a string with a zone is an instant, and its wall-clock time on the host is what gets compared) and column names that the model does not list or that Jet does not have. Dates are compared as wall-clock time, so the result does not depend on the host time zone or on daylight-saving shifts (a Jet value such as `9999-12-31 23:59:59` is no longer mistaken for year 10000 on hosts west of UTC). A `DATE` column of the model whose Jet values cannot be read as dates (for example a text column declared as `DATE`) makes `select` (with or without a `find`) and `delAll` with a `find` reject as a whole, even when the `find` does not use that column; `delAll()` without a `find` is not affected. **Only columns declared with a type that maps to a Jet column type can be used in a `find`:** `STRING` `TEXT` `CHAR` `CITEXT` `UUID` (text), `INTEGER` `BIGINT` `SMALLINT` `MEDIUMINT` `TINYINT` (integer), `FLOAT` `REAL` `DOUBLE` `DECIMAL` `NUMBER` (number), `DATE` `DATEONLY` (date-time) and `BOOLEAN` (yes/no). A `find` that uses a column declared with any other type (`TIME`, `ENUM`, `JSON`, `JSONB`, `BLOB`, `UUIDV1`, `UUIDV4`, `NOW`, `ARRAY`, `RANGE`, `GEOMETRY`, `GEOGRAPHY`, `HSTORE`, `INET`, `CIDR`, `MACADDR`, `TSVECTOR`) rejects as a whole with `invalid find: column type <TYPE> is not supported at [find.<column>]` (any operator, `null` and nested `$and` / `$or` included; the message never contains the value), before the table is read and before anything is deleted. Jet has no such column types (and no time-only type), so such a declaration is a mistake, and the in memory filter would compare the column differently from Jet: letter case matters, date-time text is compared as text, so `delAll({ name: { $ne: 'APPLE' } })` would also delete `apple`. Declare the column as `STRING` / `TEXT`, `INTEGER`, `DOUBLE`, `DATE` (a Jet time-only value is stored with the date 1899-12-30 and compares correctly) or `BOOLEAN`, whichever matches its Jet type. A column of another type does no harm as long as no `find` uses it (`select()` and `delAll()` without a `find` are not affected; a model with an `ARRAY`, `GEOMETRY` or `GEOGRAPHY` column already made every `select` fail before this release, and still does). Note that a Jet DATETIME column declared as `STRING` or `TEXT` is accepted but compared as text, so `$eq` / `$ne` with a space separated date-time string misbehave; declare it as `DATE`. Column names in a `find` must match the model exactly (`ID` for `id` is rejected). A column whose name is outside the grammar above (for example `p$x`) can still be read with `select()` but can no longer be used in a `find`.

Primary key conditions (`{ id: value }`, `$eq` `$ne` `$in` `$nin`) are decided by Jet itself, with the same rules as `selectByPk`, `del` and `insert`: the strings `'K2 '` and `'k2'` are the same key (letter case, trailing spaces, full width forms and kana are ignored). A `$ne` / `$nin` value that is not a valid key (a boolean, a `Date`, `''` or a type that does not fit the key column) rejects, because treating it as "matches nothing" would turn the negation into "matches everything"; in positive conditions such a value simply matches no row. `{ id: { $ne: null } }` is not such a value: like on every other column it means "is not NULL" (a primary key is never `NULL`, so it matches every row) and the portable form `{ $and: [{ id: { $ne: null } }, { id: { $ne: x } }] }` works on a primary key too; take care with `delAll({ id: { $ne: variable } })`, which deletes every row when the variable is `null`. A bound of `$gt` `$gte` `$lt` `$lte` on the primary key is compared by the in memory filter like a bound on any other column of that type: a valid key value is used as it is, a non integer number against an integer key (`{ k: { $gt: 2.5 } }`) or a string of more than 255 characters compare correctly, and a bound that does not fit the column type (`'abc'` or a boolean against an integer key) rejects.

Differences from MongoDB you should know: `NULL` follows SQL three valued logic, so `$ne` and `$nin` do not match rows whose column is `NULL`. To say it explicitly use the portable forms (they return the same rows on every `w-orm-*` package): leave `NULL` out with `{ $and: [{ f: { $ne: null } }, { f: { $ne: x } }] }`, or keep it with `{ $or: [{ f: null }, { f: { $ne: x } }] }`. Strings are compared by Jet and by the in memory filter without regard to letter case (`{ name: 'PETER' }` finds `peter`), and there is no pattern matching: to search for a substring, `select()` and filter in memory. A Yes/No column cannot hold `NULL` in Jet (it is stored as false), so `{ flag: { $ne: true } }` also returns rows that were written without a value.

**`delAll` needs care.** `delAll()`, `delAll(undefined)` and `delAll({})` delete every row without asking; only a condition makes it a partial delete. Use it sparingly and prefer `del` for single rows; a `find` that is not a condition object rejects instead of deleting everything. Check what a condition matches with `select(find)` first. If the condition comes from a variable that may be `undefined`, `null` or an empty array, decide that yourself before calling: `undefined` values and `$nin: []` reject (they are never ignored), `$in: []` matches nothing.

### Breaking changes: condition whitelist

The condition syntax was cut down to the whitelist above (series wide, issue "condition whitelist"). The "before" column is what the previous release (1.0.36, with `w-orm-reladb` 1.1.9) did, checked by running it against an eleven row table; there is no transition period.

| `find` | before (1.0.36) | now |
|---|---|---|
| `null`, `[]`, `[{ id: 'a' }]`, a string, a number, `true`, a `BigInt`, a `Symbol`, a `Proxy` around `{}` as the whole `find` | `select` returned **every row** and `delAll` **deleted every row** (treated as `{}`) | rejects: `invalid find: condition must be a plain object …` (a `Proxy` around `{}`: `an empty find must be an ordinary object`) |
| `$not` (on a column and at document level), `$nor`, `$exists` | supported | rejects (`unsupported operator`); express it with `$ne` / `$nin` / `$gt` … / `$and` / `$or` (see the portable forms above) |
| `$regex` with `$options`, a `RegExp` value | substring match, case insensitive (`{ name: { $regex: 'pet' } }` matched `peter` and `Peter`) | rejects; use equality (case insensitive) or `select()` and filter in memory |
| an array as a column value, `{ id: ['a', 'b'] }`; a scalar as `$in`, `{ id: { $in: 'a' } }` | treated as `$in` | rejects: `array value is not supported`, `value must be an array`; write `{ id: { $in: ['a', 'b'] } }` |
| sequelize `Op` symbols as keys (`Op.or`, `Op.in`, `Op.like`, `Op.and`, `Op.not` …) | accepted | rejects: `symbol key is not allowed` |
| `null` inside `$in` | accepted (`{ name: { $in: [null, 'abc'] } }` matched the `NULL` row and `abc`) | rejects; use `{ $or: [{ col: null }, { col: { $in: […] } }] }` |
| `null` inside `$nin` | accepted (`$nin: [null]` meant "is not NULL") | rejects; use `{ col: { $ne: null } }`, or drop the `null` (`$nin` already skips `NULL` rows) |
| `$nin: []` | matched **every row** (`delAll` deleted all) | rejects |
| `$and: [{}]`, `$or: [{}]` | matched **every row** | rejects: `empty condition` |
| `undefined` or a `BigInt` as a primary key value, `{ id: undefined }`, `{ id: { $in: ['a', undefined] } }`, `{ id: 123n }`, `{ id: {} }` | matched no row (`{ id: { $in: ['a', undefined] } }` matched `a`); `delAll` deleted nothing (on the other columns `undefined` already rejected) | rejects: `undefined is not allowed`, `unsupported value type`, `empty operator object` |
| a `String` / `Number` wrapper object as a primary key value, `{ id: new String('a') }` | unwrapped and matched (on the other columns it already rejected) | rejects: `unsupported value type` |
| a string containing NUL or a lone surrogate as a value | matched no row | rejects |
| a getter or non enumerable property, an array with extra properties | accepted (the getter was called) | rejects: `accessor property is not allowed`, `non-enumerable` |
| a column name outside `^[\p{L}_][\p{L}\p{M}\p{N}_]*$` (for example `p$x`) | accepted when the model listed that column | rejects: `unsupported column name` |
| `$in` / `$nin` with more than 2000 values | accepted (5000 values worked; every primary key value costs one statement) | rejects: `array is too large (> 2000)` |
| `$and` / `$or` with 999 items | database error `Expression tree is too large` | accepted; the limit is 999 items |
| `$and` / `$or` with more than 999 items | database error `Expression tree is too large` | rejects: `array is too large (> 999)` |
| a chain of 32 nested `$and` levels | rejects (`find is too deep`) | accepted (the limit is 32 levels) |
| error message format | `invalid find: unsupported operator [$foo] at [name.$foo]` | `invalid find: unsupported operator [$foo] at [find.name.$foo]` (the path starts with `find`, and the wording of the value errors changed: `value must be a string, finite number, boolean, Date or null` became `unsupported value type [x]`; a primary key value that is not valid under `$ne` / `$nin` used to reject with `invalid id in negative condition: <value>` and now with `invalid find: invalid primary key value in negative condition at [find.id.$ne]`, without echoing the value) |

Unchanged: a `find` that is a function, a `Date` or a class instance rejects, `$and: []` / `$or: []` reject, unknown or misspelled column names reject, and `{ id: { $ne: undefined } }` keeps rejecting. (Since the release after 1.0.38 `{ id: { $ne: null } }` is accepted and means "is not NULL", and a primary key range bound that does not fit the key type is compared by the column type or rejects instead of silently matching nothing.)

`select(null)` and `delAll(null)` style calls must become `select({})` / `delAll({})` (or no argument).

### Well-formed strings

`w-orm-mdb` and the Jet engine exchange text through UTF-8 (the `connMDB.exe` bridge), which turns a **lone surrogate** (a UTF-16 half of a pair; `str.isWellFormed()` is `false`) into U+FFFD. Written that way, two different keys became one key (an overwrite, or a `del` that hits another row), a value read back differently from the value written, and a table name could point at another table. The series wide rule (shared with the other `w-orm-*` packages, decided by `chkOrmStr` / `chkOrmData` of `wsemi`) is therefore to **reject such strings instead of storing something else**. U+FFFD itself, emoji and other paired surrogates are well formed and work as before.

| Where | Rule |
|---|---|
| Primary key (the key of `selectByPk` / the pk column of `insert`, `insertBulk`, `save`, `del`) | a string must contain **no NUL and no lone surrogate** |
| Data written by `insert`, `insertBulk`, `save` | key names and string values, at any depth (nested objects, array elements, `Map`, `Set` …, also keys that are not columns of the model) must contain **no lone surrogate**; a NUL inside a value is not part of this check |
| `opt.db`, `opt.cl`, `opt.url`, `opt.storage`, `opt.pk` | no lone surrogate; the constructor throws `invalid opt.<name>: string contains lone surrogate` |

What happens with a string that fails (it never depends on `opt.autoGenPk`: a lone surrogate id is never replaced by a generated id):

| Function | Result |
|---|---|
| `insert`, `insertBulk` | rejects as a whole **before** the model is loaded and before anything is written, `error` event once, no `change`; the lowest index wins |
| `save` | that item is `{ n: 1, nInserted: 0, nModified: 0, ok: 0, err }`, the other items are processed as usual; also with `autoInsert: false` |
| `del` | that item is `{ n: 0, nDeleted: 0, ok: 0, err }` (it used to be a silent `ok: 1`), the other items are processed as usual |
| `selectByPk` | `null` (without loading the model or asking Jet) |
| `select`, `delAll` | `invalid find: …` as before |

Messages use a fixed vocabulary and **never echo the value**: `invalid id: string contains lone surrogate at [data[1].id]` (`string contains NUL` for a NUL in a key), `invalid data: string contains lone surrogate at [data[1].meta.tags[1]]` (a bad key name is shown as `<invalid key>`), `invalid opt.cl: string contains lone surrogate`. The path starts with the batch index and follows `opt.pk` for the key column. The primary key of every row becomes read-only once it has been checked and normalized, so user code that runs while the statements are built (a custom `toString` …) cannot change the key of another row of the same batch (the call fails as a whole instead). The checks run on a copy that is taken when `insert`, `insertBulk`, `save` or `del` is called, and only that copy is written (changing your object, or a prototype it shares, right after the call does not change what is written; the `find` of `select` / `delAll` is copied when the call is executed, as before). A row that is not a plain object (a class instance, `Object.create(proto)`, a subclass of `Array`, a `Map` or `Set`, an object with a custom `Symbol.toStringTag` …; a no-data input such as an empty object or an object with only unrelated getters stays "no data", as before) is flattened into a plain object holding every enumerable property (own and inherited) and every accessor of its prototype chain (class getters included), each read exactly once (inherited values and getter results are deep-copied; own values were copied by the outer copy), while the contents of a container row (the entries of a `Map`, the elements of a `Set`) are still checked from the copied original, so a getter with side effects or one that answers differently the second time, or a prototype or array shared with your object that you change after the call, cannot make the checked value differ from the written one (a getter that throws is only rethrown if the column is really read, as before); nested class instances keep their prototype and a `Map` keeps its key objects (shared references, not covered). The constructor options are read once as well (every enumerable option and every option name the package reads, enumerable or not; an options value that is not an object throws `TypeError`). As a last line of defence every string that reaches the SQL text is checked once more (`invalid data: string contains lone surrogate`, without a path), which also covers values produced by `toString`, and so is every table or column identifier (`invalid identifier: string contains lone surrogate`). A `String` wrapper object is checked through its string value and, like any value, written as the plain string (a wrapper as primary key is unwrapped first).

**Existing data is not migrated.** Before this release a lone surrogate in a value was stored as U+FFFD (the original cannot be recovered), and such a key could not be written at all. To find rows that may have been affected:

```js
let rows = await wo.select()
let suspects = rows.filter((r) => Object.values(r).some((v) => typeof v === 'string' && v.includes('�')))
```

U+FFFD is a legal character, so review the result by hand. Be careful with `del`: Jet compares text without regard to letter case, trailing spaces, width, kana and **supplementary plane characters**, so `'a'`, `'a😀'` and `'a�'` are the same key to Jet (`selectByPk('a😀')` returns the row `'a'`, and `del` removes it). This is how the Jet collation works (like the letter case rule, and like `mssql` of `w-orm-reladb`); the package does not change it. If you need exact comparisons, keep such strings out of key columns, or clean up through another column (`delAll({ name: … })`) after checking with `select`.

### Breaking changes: well-formed strings

The "before" column is what the previous release (1.0.39) did, measured with the new test suite run against it.

| Case | before (1.0.39) | now |
|---|---|---|
| a lone surrogate in a value (any column, also nested in an array that Jet turns into text) written by `insert`, `insertBulk`, `save` | stored as U+FFFD (`'a\uD800'` read back as `'a�'`) | `insert` / `insertBulk` reject as a whole, nothing written; `save`: that item `ok: 0` |
| a lone surrogate in a key name of the written object (even a key that is not a column) | ignored | rejects the same way |
| `del` with a primary key containing NUL or a lone surrogate | `{ n: 0, nDeleted: 0, ok: 1 }` | `{ n: 0, nDeleted: 0, ok: 0, err: 'invalid id: … at [data[0].id]' }` |
| `save` with such a primary key and `autoInsert: false` | `{ n: 0, …, ok: 1 }` | `ok: 0` with `err` |
| `save` with such a primary key and `autoInsert: true` | `ok: 0`, the message echoed the key | `ok: 0`, fixed message (no echo) |
| `insert` / `insertBulk` with such a primary key | rejected, the message echoed the key (`invalid data[0].id[…]`) | rejected: `invalid id: … at [data[0].id]` |
| messages for a primary key that is too long (> 255 characters), does not fit the column type, or is missing (`del`), and the `save` retry message | the key value was part of the message | no value in the message (`invalid data[1].id, can not be stored: exceeds 255 characters`, `invalid data[0].id, type mismatch with pk column […] in model […]`, `can not save data[0].id, id exceeds 255 characters`, `invalid data[0].id`) |
| constructor with a lone surrogate in `opt.db`, `opt.cl`, `opt.url`, `opt.storage`, `opt.pk` | accepted (a lone surrogate table name or path pointed at another table or file) | throws `invalid opt.<name>: string contains lone surrogate`; a `String` wrapper object in these options throws `invalid opt.<name>: not a string` |
| `insert`, `insertBulk`, `save`, `del` with `useStable: true` (the default) | the data was copied when the queue got to the call | the data is copied when the function is called; a row that is a class instance or inherits properties is flattened then (enumerable own and inherited properties and prototype accessors are kept, each read once; a non enumerable plain data property on the prototype is no longer read) |
| the options object passed to the constructor | the defaults were written back into your object and every option was read again on each use; a non object (`null`, a string …) threw a `TypeError` by accident | your object is read once and left untouched; changing it afterwards has no effect on the instance; a non object still throws `TypeError: invalid opt: not an object` |

Unchanged: a primary key longer than 255 characters (`del` answers `ok: 1`, `n: 0`; `selectByPk` `null`), NUL inside a value (Jet's own error), `U+FFFD` and paired surrogates anywhere.

### Breaking changes: date conditions as wall-clock time

Jet stores a DATETIME as a wall-clock time without a time zone. Date conditions on columns other than the primary key (columns the model declares as `DATE`) are now compared as wall-clock time (needs `w-orm-reladb` 1.1.14 or later), instead of as instants in the host time zone. The "before" column is what the previous release (1.0.40) did, measured with the new test suite run against it (10 host time zones, a real mdb file).

| Case | before (1.0.40) | now |
|---|---|---|
| a host west of UTC (for example `America/Los_Angeles`, `America/New_York`, `America/Sao_Paulo`) and a row with the usual "never expires" value `9999-12-31 23:59:59` | the value became year 10000 and range conditions were wrong: `delAll({ expires: { $lt: today } })` **deleted that row**, and the value itself was rejected as a condition (`does not match column type [date]`) | the row is not matched by `$lt today`; the value is accepted as a condition |
| a host with daylight saving (for example `Europe/Berlin`, `America/New_York`, `Australia/Lord_Howe`) and a wall-clock time that the host skips (`2026-03-29 02:30:00` in Berlin) or repeats | the time was shifted to another one, so equality and range conditions answered wrongly; the skipped time was rejected as a condition value | compared as written (no shift); a skipped time is a valid condition value |
| a string without a zone, `'2026-10-20T00:00:00'` or `'2026-10-20 00:00:00'` | read as local time of the host | taken as the wall-clock time it states, the same on every host |
| a `Date`, an epoch number or a string with a zone (`'...Z'`, `'+08:00'`) as condition | an instant in the host zone | still an instant; its wall-clock time on the host is what is compared (`new Date(2026, 0, 1)` is `2026-01-01 00:00:00`) |
| a host east of UTC without daylight saving (`Asia/Taipei`, `UTC`, `Asia/Kolkata`) | correct | unchanged |
| a `DATE` column whose Jet value cannot be read as a date (for example a text column declared as `DATE`, holding `'garbage'`) | the value became the text `Invalid date` and **matched** `$gt` / `$gte` / `$ne` conditions, so `delAll` deleted that row; `select()` returned every row | `select` (with or without a `find`) and `delAll` with a `find` **reject as a whole**: `invalid data: date can not be converted to floating time at [row[<index>].<column>]` (no value in the message); `delAll()` without a `find` and an empty table are not affected |

Unchanged: a date string without a time (`'2026-01-01'`) rejects, `DATEONLY` columns compare by day, primary keys are decided by Jet, and a model without unreadable `DATE` values sees no difference on hosts without a negative UTC offset or daylight saving.

### Breaking changes: column types in a `find`

A `find` may now only use columns that the model declares as `STRING` `TEXT` `CHAR` `CITEXT` `UUID`, `INTEGER` `BIGINT` `SMALLINT` `MEDIUMINT` `TINYINT`, `FLOAT` `REAL` `DOUBLE` `DECIMAL` `NUMBER`, `DATE` `DATEONLY` or `BOOLEAN` (see the whitelist section above). Any other declared type (`TIME`, `ENUM`, `JSON`, `JSONB`, `BLOB`, `UUIDV1`, `UUIDV4`, `NOW`, `ARRAY`, `RANGE`, `GEOMETRY`, `GEOGRAPHY`, `HSTORE`, `INET`, `CIDR`, `MACADDR`, `TSVECTOR`) in a `find` rejects as a whole: `invalid find: column type <TYPE> is not supported at [find.<column>]`, before the table is read and before anything is deleted. The "before" column is what the previous release (1.0.40) did, measured against a real mdb file with rows `apple` / `banana` / `cherry` (`value` 5 / 10 / 100, date-times 2020-01-01 10:00, 2026-05-01 10:00, 2099-01-01 00:00).

| Column declared as | before (1.0.40) | now |
|---|---|---|
| `ENUM`, `JSON`, `JSONB`, `BLOB`, `UUIDV1`, `UUIDV4`, `NOW`, `RANGE`, `HSTORE`, `INET`, `CIDR`, `MACADDR` or `TSVECTOR` on a Jet text column | letter case was not ignored (Jet ignores it): `delAll({ name: { $ne: 'APPLE' } })` **also deleted `apple`** (Jet matches only `banana` and `cherry`), `{ name: 'APPLE' }` and `$in: ['APPLE', …]` missed `apple` | rejects |
| the same types on a Jet DATETIME column | date-time values were compared as text, so a space separated condition never equals the stored `T` separated value: `delAll({ dt: { $ne: '2026-05-01 10:00:00' } })` **also deleted the row with exactly that time**, `$eq` found nothing | rejects |
| `ENUM` or `BLOB` on a Jet number column | numbers were compared as text: `{ value: { $lt: 50 } }` also matched `100`, `{ value: { $gt: 9 } }` matched nothing | rejects |
| `TIME` on a Jet DATETIME column (Jet has no time-only type) | no conversion and no check, compared as text: on rows `08:30` and `20:30`, `delAll({ dt: { $gt: '12:00:00' } })` **deleted both rows** (Jet itself matches only `20:30`), `$lt: '12:00:00'` matched none | rejects; declare the column as `DATE` (a time-only value is stored with the date 1899-12-30) |
| `ARRAY`, `GEOMETRY` or `GEOGRAPHY` | every `find` (and `select()`) failed with an internal message of the underlying library (`values.map is not a function`, `GeometryType undefined not supported`) | a `find` using the column rejects with the message above; `select()` still fails as before |
| a column of a supported type (including `STRING` on a text column, `DOUBLE`, `INTEGER`, `BOOLEAN`, `DATE`) | correct | unchanged |

If a model declares such a type on a column that you filter on, change the declaration to the type that matches the Jet column (text `STRING` / `TEXT`, number `INTEGER` / `DOUBLE`, date-time `DATE`, yes/no `BOOLEAN`); the mdb file itself needs no change, the declaration lives in the model only. A Jet DATETIME column declared as `STRING` or `TEXT` is still accepted but compared as text (same misbehaviour as the second row); declare it as `DATE`.

#### Example by js settings 
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-mdb/blob/main/g-js.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-mdb'


let username = ''
let password = ''
let opt = {
    url: `mdb://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'js', //default
    // pk: 'id', //default
    // autoGenPk: true, //default
    storage: './worm.mdb',
}

//因worm.mdb可能被修改, 先刪除再由worm_def.mdb複製一份來用
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}
fs.copyFileSync('./worm_def.mdb', opt.storage)

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {
    //測試mdb


    //w
    let w = wo(opt)


    //on, change於資料實際異動成功後發出, error於整批性錯誤或逐筆失敗時發出
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert, 僅於主鍵不存在時寫入, 已存在者跳過且不覆寫
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //insert, 主鍵已存在故跳過, nInserted為0而非錯誤
    await w.insert([{ id: 'id-peter', name: 'peter(should be skipped)' }])
        .then(function(msg) {
            console.log('insert existed then', msg)
        })
        .catch(function(msg) {
            console.log('insert existed catch', msg)
        })


    //insert, option.returnList為true時改回傳與輸入等長且保序之逐筆結果, 供得知[是哪幾筆]為新資料
    await w.insert([{ id: 'id-peter', name: 'existed' }, { id: 'id-new', name: 'new', value: 1 }], { returnList: true })
        .then(function(msg) {
            console.log('insert returnList then', msg)
        })
        .catch(function(msg) {
            console.log('insert returnList catch', msg)
        })


    //insertBulk, 全批視為一個單位: 全部插入成功, 或一筆都不寫入
    await w.insertBulk([{ id: 'id-bulk-1', name: 'bulk1', value: 1 }, { id: 'id-bulk-2', name: 'bulk2', value: 2 }])
        .then(function(msg) {
            console.log('insertBulk then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk catch', msg)
        })


    //insertBulk, 任一筆主鍵已存在即整批reject且不寫入任何一筆
    await w.insertBulk([{ id: 'id-bulk-3', name: 'bulk3' }, { id: 'id-peter', name: 'conflict' }])
        .then(function(msg) {
            console.log('insertBulk conflict then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk conflict catch', String(msg))
        })
    console.log('insertBulk conflict, id-bulk-3 =', await w.selectByPk('id-bulk-3'))


    //save, 以主鍵為準更新既有數據, 未給之欄位保留
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //save, 合併後內容與現值相同則不寫入, nModified為0
    await w.save([{ id: 'id-peter', name: 'peter(modify)' }])
        .then(function(msg) {
            console.log('save same then', msg)
        })
        .catch(function(msg) {
            console.log('save same catch', msg)
        })


    //selectByPk, 由主鍵直讀單筆, 查無則回null
    console.log('selectByPk', await w.selectByPk('id-rosemary'))
    console.log('selectByPk not found', await w.selectByPk('id-not-exist'))


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by name, Jet之字串比對不分大小寫(條件僅支援系列白名單, 不支援$regex)
    let sr = await w.select({ name: 'PETER(MODIFY)' })
    console.log('selectNocase', sr)


    //del, 主鍵未命中為正常結果(ok:1), 未帶有效主鍵為該筆失敗(ok:0並附err)
    await w.del([{ id: 'id-peter' }, { id: 'id-not-exist' }, { name: 'no-pk' }])
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //delAll, 依條件刪除, n為實際刪除筆數
    await w.delAll({ value: { '$gte': 400 } })
        .then(function(msg) {
            console.log('delAll by find then', msg)
        })
        .catch(function(msg) {
            console.log('delAll by find catch', msg)
        })


}
test().catch((err) => console.log('err:', err))
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change insert
// insert existed then { n: 1, nInserted: 0, ok: 1 } //主鍵已存在故跳過, 屬正常結果
// change insert
// insert returnList then [ { n: 1, nInserted: 0, ok: 1 }, { n: 1, nInserted: 1, ok: 1 } ] //與輸入等長保序
// change insertBulk
// insertBulk then { n: 2, nInserted: 2, ok: 1 }
// error insertBulk The changes you requested to the table were not successful because they would create duplicate values...
// insertBulk conflict catch Error: The changes you requested to the table were not successful because they would create duplicate values...
// insertBulk conflict, id-bulk-3 = null //整批reject且不寫入任何一筆
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //主鍵不存在且autoInsert為false
// ]
// change save
// save same then [ { n: 1, nInserted: 0, nModified: 0, ok: 1 } ] //合併後內容相同故未寫入
// selectByPk { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// selectByPk not found null
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 },
//   { id: 'id-new', name: 'new', value: 1 },
//   { id: 'id-bulk-1', name: 'bulk1', value: 1 },
//   { id: 'id-bulk-2', name: 'bulk2', value: 2 }
// ]
// select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $and, $gt, $lt [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $or, $gte, $lte [ { id: '{random id}', name: 'kettle', value: 456 } ]
// selectNocase [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
// error del invalid data[2].id
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },        //主鍵命中並刪除
//   { n: 0, nDeleted: 0, ok: 1 },        //主鍵未命中, 屬正常結果
//   { n: 0, nDeleted: 0, ok: 0, err: 'invalid data[2].id' } //未帶有效主鍵, 屬該筆失敗
// ]
// change delAll
// delAll by find then { n: 1, nDeleted: 1, ok: 1 }
```

#### Example by json settings 
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-mdb/blob/main/g-json.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-mdb'


let username = ''
let password = ''
let opt = {
    url: `mdb://${username}:${password}`,
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    modelType: 'json',
    // pk: 'id', //default
    // autoGenPk: true, //default
    storage: './worm.mdb',
}

//因worm.mdb可能被修改, 先刪除再由worm_def.mdb複製一份來用
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}
fs.copyFileSync('./worm_def.mdb', opt.storage)

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
    {
        id: '',
        name: 'kettle(modify)'
    },
]

async function test() {
    //測試mdb


    //w
    let w = wo(opt)


    //on, change於資料實際異動成功後發出, error於整批性錯誤或逐筆失敗時發出
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert, 僅於主鍵不存在時寫入, 已存在者跳過且不覆寫
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //insert, 主鍵已存在故跳過, nInserted為0而非錯誤
    await w.insert([{ id: 'id-peter', name: 'peter(should be skipped)' }])
        .then(function(msg) {
            console.log('insert existed then', msg)
        })
        .catch(function(msg) {
            console.log('insert existed catch', msg)
        })


    //insert, option.returnList為true時改回傳與輸入等長且保序之逐筆結果, 供得知[是哪幾筆]為新資料
    await w.insert([{ id: 'id-peter', name: 'existed' }, { id: 'id-new', name: 'new', value: 1 }], { returnList: true })
        .then(function(msg) {
            console.log('insert returnList then', msg)
        })
        .catch(function(msg) {
            console.log('insert returnList catch', msg)
        })


    //insertBulk, 全批視為一個單位: 全部插入成功, 或一筆都不寫入
    await w.insertBulk([{ id: 'id-bulk-1', name: 'bulk1', value: 1 }, { id: 'id-bulk-2', name: 'bulk2', value: 2 }])
        .then(function(msg) {
            console.log('insertBulk then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk catch', msg)
        })


    //insertBulk, 任一筆主鍵已存在即整批reject且不寫入任何一筆
    await w.insertBulk([{ id: 'id-bulk-3', name: 'bulk3' }, { id: 'id-peter', name: 'conflict' }])
        .then(function(msg) {
            console.log('insertBulk conflict then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk conflict catch', String(msg))
        })
    console.log('insertBulk conflict, id-bulk-3 =', await w.selectByPk('id-bulk-3'))


    //save, 以主鍵為準更新既有數據, 未給之欄位保留
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //save, 合併後內容與現值相同則不寫入, nModified為0
    await w.save([{ id: 'id-peter', name: 'peter(modify)' }])
        .then(function(msg) {
            console.log('save same then', msg)
        })
        .catch(function(msg) {
            console.log('save same catch', msg)
        })


    //selectByPk, 由主鍵直讀單筆, 查無則回null
    console.log('selectByPk', await w.selectByPk('id-rosemary'))
    console.log('selectByPk not found', await w.selectByPk('id-not-exist'))


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select
    let so = await w.select({ id: 'id-rosemary' })
    console.log('select', so)


    //select by $and, $gt, $lt
    let spa = await w.select({ '$and': [{ value: { '$gt': 123 } }, { value: { '$lt': 200 } }] })
    console.log('select by $and, $gt, $lt', spa)


    //select by $or, $gte, $lte
    let spb = await w.select({ '$or': [{ value: { '$lte': -1 } }, { value: { '$gte': 400 } }] })
    console.log('select by $or, $gte, $lte', spb)


    //select by name, Jet之字串比對不分大小寫(條件僅支援系列白名單, 不支援$regex)
    let sr = await w.select({ name: 'PETER(MODIFY)' })
    console.log('selectNocase', sr)


    //del, 主鍵未命中為正常結果(ok:1), 未帶有效主鍵為該筆失敗(ok:0並附err)
    await w.del([{ id: 'id-peter' }, { id: 'id-not-exist' }, { name: 'no-pk' }])
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //delAll, 依條件刪除, n為實際刪除筆數
    await w.delAll({ value: { '$gte': 400 } })
        .then(function(msg) {
            console.log('delAll by find then', msg)
        })
        .catch(function(msg) {
            console.log('delAll by find catch', msg)
        })


}
test().catch((err) => console.log('err:', err))
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change insert
// insert existed then { n: 1, nInserted: 0, ok: 1 } //主鍵已存在故跳過, 屬正常結果
// change insert
// insert returnList then [ { n: 1, nInserted: 0, ok: 1 }, { n: 1, nInserted: 1, ok: 1 } ] //與輸入等長保序
// change insertBulk
// insertBulk then { n: 2, nInserted: 2, ok: 1 }
// error insertBulk The changes you requested to the table were not successful because they would create duplicate values...
// insertBulk conflict catch Error: The changes you requested to the table were not successful because they would create duplicate values...
// insertBulk conflict, id-bulk-3 = null //整批reject且不寫入任何一筆
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 0, nInserted: 0, nModified: 0, ok: 1 } //主鍵不存在且autoInsert為false
// ]
// change save
// save same then [ { n: 1, nInserted: 0, nModified: 0, ok: 1 } ] //合併後內容相同故未寫入
// selectByPk { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// selectByPk not found null
// select all [ //以json格式之models設定, 結果與js格式相同
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 },
//   { id: 'id-new', name: 'new', value: 1 },
//   { id: 'id-bulk-1', name: 'bulk1', value: 1 },
//   { id: 'id-bulk-2', name: 'bulk2', value: 2 }
// ]
// select [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $and, $gt, $lt [ { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 } ]
// select by $or, $gte, $lte [ { id: '{random id}', name: 'kettle', value: 456 } ]
// selectNocase [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
// error del invalid data[2].id
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },        //主鍵命中並刪除
//   { n: 0, nDeleted: 0, ok: 1 },        //主鍵未命中, 屬正常結果
//   { n: 0, nDeleted: 0, ok: 0, err: 'invalid data[2].id' } //未帶有效主鍵, 屬該筆失敗
// ]
// change delAll
// delAll by find then { n: 1, nDeleted: 1, ok: 1 }
```

#### Example for encryption by js settings 
> **Link:** [[dev source code](https://github.com/yuda-lyu/w-orm-mdb/blob/main/g-js-encryption.mjs)]
```alias
import fs from 'fs'
import wo from 'w-orm-mdb'


let username = 'username'
let password = 'password'
let opt = {
    url: `mdb://${username}:${password}`, //加密檔之密碼組成為`${username}:${password}`
    db: 'worm',
    cl: 'users',
    fdModels: './models',
    // modelType: 'js', //default
    // pk: 'id', //default
    // autoGenPk: true, //default
    storage: './worm.mdb',
    useEncryption: true,
}

//因worm.mdb可能被修改, 先刪除再由worm_encryption_def.mdb複製一份來用
if (fs.existsSync(opt.storage)) {
    fs.unlinkSync(opt.storage)
}
fs.copyFileSync('./worm_encryption_def.mdb', opt.storage) //複製加密版, 密碼為[username:password]

let rs = [
    {
        id: 'id-peter',
        name: 'peter',
        value: 123,
    },
    {
        id: 'id-rosemary',
        name: 'rosemary',
        value: 123.456,
    },
    {
        id: '',
        name: 'kettle',
        value: 456,
    },
]

let rsm = [
    {
        id: 'id-peter',
        name: 'peter(modify)'
    },
    {
        id: 'id-rosemary',
        name: 'rosemary(modify)'
    },
]

async function test() {
    //測試加密mdb


    //w
    let w = wo(opt)


    //on
    w.on('change', function(mode, data, res) {
        console.log('change', mode)
    })
    w.on('error', function(mode, data, err) {
        console.log('error', mode, err)
    })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll then', msg)
        })
        .catch(function(msg) {
            console.log('delAll catch', msg)
        })


    //insert
    await w.insert(rs)
        .then(function(msg) {
            console.log('insert then', msg)
        })
        .catch(function(msg) {
            console.log('insert catch', msg)
        })


    //insertBulk
    await w.insertBulk([{ id: 'id-bulk-1', name: 'bulk1', value: 1 }])
        .then(function(msg) {
            console.log('insertBulk then', msg)
        })
        .catch(function(msg) {
            console.log('insertBulk catch', msg)
        })


    //save
    await w.save(rsm, { autoInsert: false })
        .then(function(msg) {
            console.log('save then', msg)
        })
        .catch(function(msg) {
            console.log('save catch', msg)
        })


    //selectByPk
    console.log('selectByPk', await w.selectByPk('id-rosemary'))


    //select all
    let ss = await w.select()
    console.log('select all', ss)


    //select by name, Jet之字串比對不分大小寫(條件僅支援系列白名單, 不支援$regex)
    let sr = await w.select({ name: 'PETER(MODIFY)' })
    console.log('selectNocase', sr)


    //del
    await w.del([{ id: 'id-peter' }])
        .then(function(msg) {
            console.log('del then', msg)
        })
        .catch(function(msg) {
            console.log('del catch', msg)
        })


    //delAll
    await w.delAll()
        .then(function(msg) {
            console.log('delAll all then', msg)
        })
        .catch(function(msg) {
            console.log('delAll all catch', msg)
        })


}
test().catch((err) => console.log('err:', err))
// change delAll
// delAll then { n: 0, nDeleted: 0, ok: 1 }
// change insert
// insert then { n: 3, nInserted: 3, ok: 1 }
// change insertBulk
// insertBulk then { n: 1, nInserted: 1, ok: 1 }
// change save
// save then [
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 },
//   { n: 1, nInserted: 0, nModified: 1, ok: 1 }
// ]
// selectByPk { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 }
// select all [
//   { id: 'id-peter', name: 'peter(modify)', value: 123 },
//   { id: 'id-rosemary', name: 'rosemary(modify)', value: 123.456 },
//   { id: '{random id}', name: 'kettle', value: 456 },
//   { id: 'id-bulk-1', name: 'bulk1', value: 1 }
// ]
// selectNocase [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
// change del
// del then [ { n: 1, nDeleted: 1, ok: 1 } ]
// change delAll
// delAll all then { n: 3, nDeleted: 3, ok: 1 }
```
