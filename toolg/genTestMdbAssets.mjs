import fs from 'fs'
import path from 'path'
import jetOpen from '../src/jet.mjs'


//產生測試專用mdb資產至test/assets/, 供unit測試與CI使用
//透過connMDB.exe(內建Jet 4.0 + ADOX)程式化產生, 可重現
//表結構比照models/users.js: id TEXT(255) PK, name TEXT(255), value DOUBLE
//需於專案根目錄執行: node toolg/genTestMdbAssets.mjs [檔名...]
//未給檔名時產生全部; 給檔名時僅產生指定者(如 node toolg/genTestMdbAssets.mjs worm_pk_def.mdb), 以免重產未變更之資產


let fdAssets = './test/assets'

let sqlCreateTable = 'CREATE TABLE [users] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255), [value] DOUBLE)'

//主鍵命中判定測試用之各資料表, 對應model於test/assets/models/
let sqlsPk = [
    sqlCreateTable,
    'CREATE TABLE [ipk] ([id] LONG CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255))', //整數主鍵
    'CREATE TABLE [dpk] ([id] DOUBLE CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255))', //浮點主鍵
    'CREATE TABLE [upk] ([id] TEXT(36) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255))', //model為UUID之文字主鍵
    'CREATE TABLE [uqx] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [code] TEXT(50) CONSTRAINT [uqcode] UNIQUE, [name] TEXT(255))', //另有唯一索引
    'CREATE TABLE [tt] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [fDate] DATETIME, [fBool] YESNO, [fDec] DECIMAL(18,4), [fInt] LONG, [fDbl] DOUBLE, [fStr] TEXT(255), [fText] MEMO)', //各型別欄位
    'CREATE TABLE [ukey] ([uid] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [id] TEXT(255), [name] TEXT(255))', //主鍵欄名非id且另有非主鍵欄id
]

//條件(find)轉譯測試用之各資料表(空表, 資料列由test/unit-find-setup.mjs於測試時寫入), 對應model於test/assets/models/
let sqlsFind = [
    'CREATE TABLE [tc] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255), [value] DOUBLE, [n] LONG, [dt] DATETIME, [b] BIT, [p$x] TEXT(50), [length] LONG)', //字串主鍵與各型別欄位, 含欄名length與p$x
    'CREATE TABLE [tk] ([k] LONG CONSTRAINT [pk] PRIMARY KEY, [id] TEXT(50), [v] DOUBLE)', //整數主鍵k且另有非主鍵文字欄id
]

//條件(find)系列白名單案例表測試用(wsemi/src/_cvOrmFindCases.mjs之columns: id name age g t flag d), 空表, 資料列由test/unit-find-wl-setup.mjs於測試時寫入, 對應model於test/assets/models/tw.js
let sqlsWl = [
    'CREATE TABLE [tw] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255), [age] LONG, [g] TEXT(50), [t] TEXT(255), [flag] YESNO, [d] DATETIME)',
]

async function gen(fn, password, sqls) {

    //fp
    let fp = path.resolve(fdAssets, fn)

    //clear
    if (fs.existsSync(fp)) {
        fs.unlinkSync(fp)
    }

    //jet
    let jet = jetOpen({ path: fp, password })

    //create
    await jet.create()

    //create table
    for (let sql of sqls) {
        await jet.execute(sql)
    }

    console.log(`generated: ${fp}${password ? ' (encrypted)' : ''}`)
}

async function main() {

    //fdAssets
    if (!fs.existsSync(fdAssets)) {
        fs.mkdirSync(fdAssets, { recursive: true })
    }

    //items
    let items = [
        ['worm_def.mdb', '', [sqlCreateTable]], //一般測試檔
        ['worm_encryption_def.mdb', 'username:password', [sqlCreateTable]], //加密測試檔, 密碼組成比照WOrmMdb: `${username}:${password}`
        ['worm_pk_def.mdb', '', sqlsPk], //主鍵命中判定測試檔
        ['worm_find_def.mdb', '', sqlsFind], //條件(find)轉譯測試檔
        ['worm_wl_def.mdb', '', sqlsWl], //條件(find)系列白名單案例表測試檔
    ]

    //fns, 未給則全部
    let fns = process.argv.slice(2)

    for (let [fn, password, sqls] of items) {
        if (fns.length > 0 && fns.indexOf(fn) < 0) {
            continue
        }
        await gen(fn, password, sqls)
    }

}

main()
    .catch((err) => {
        console.log('err:', err)
        process.exit(1)
    })
