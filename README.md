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


    //select by regex
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)


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
// selectReg [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
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


    //select by regex
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)


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
// selectReg [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
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


    //select by regex
    let sr = await w.select({ name: { $regex: 'PeT', $options: '$i' } })
    console.log('selectReg', sr)


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
// selectReg [ { id: 'id-peter', name: 'peter(modify)', value: 123 } ]
// change del
// del then [ { n: 1, nDeleted: 1, ok: 1 } ]
// change delAll
// delAll all then { n: 3, nDeleted: 3, ok: 1 }
```
