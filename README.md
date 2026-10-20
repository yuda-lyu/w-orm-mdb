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

On top of the whitelist the rows are filtered in memory through the model (`w-orm-reladb`), which rejects what cannot be translated with its meaning intact (an empty table cannot show which columns exist, so there a column that the model lists but the table lacks is only rejected once the table has rows): values that do not fit the column type (for example `'abc'` against a numeric column, or a date string without a time such as `'2026-01-01'`; a date-time string without a zone is read as local time of the host, as Jet stores no zone) and column names that the model does not list or that Jet does not have. Column names in a `find` must match the model exactly (`ID` for `id` is rejected). A column whose name is outside the grammar above (for example `p$x`) can still be read with `select()` but can no longer be used in a `find`.

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
// error del invalid id[undefined]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },        //主鍵命中並刪除
//   { n: 0, nDeleted: 0, ok: 1 },        //主鍵未命中, 屬正常結果
//   { n: 0, nDeleted: 0, ok: 0, err: 'invalid id[undefined]' } //未帶有效主鍵, 屬該筆失敗
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
// error del invalid id[undefined]
// change del
// del then [
//   { n: 1, nDeleted: 1, ok: 1 },        //主鍵命中並刪除
//   { n: 0, nDeleted: 0, ok: 1 },        //主鍵未命中, 屬正常結果
//   { n: 0, nDeleted: 0, ok: 0, err: 'invalid id[undefined]' } //未帶有效主鍵, 屬該筆失敗
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
