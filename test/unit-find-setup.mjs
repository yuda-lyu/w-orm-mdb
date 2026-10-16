import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'


//unit-find-*之共用層: 條件(find)轉譯測試之資料表、種子與逐列斷言
//註: 本檔不含測試案例, 不符mocha之test/*.test.mjs而不被當成測試檔載入
//註: 規則見CLAUDE_rulebook.md之R-FIND(非主鍵條件以w-orm-reladb之cvFind為準, 主鍵條件依R-PK)


//字串主鍵表tc之資料列: id, name, value, n, dt, b, p$x, length
//含NULL、%、_、[a-c]、!、大小寫不同之name, 以及欄名length與p$x之值; dt皆為固定之本地時間(Jet之DATETIME無時區)
//註: d列原為「今日午夜」(供1.0.35把DATE欄之未知運算子stringify為今日之回歸X12), 致D3/D9等之應然隨執行日期而變(run02外審opus、sol);
//改為固定日期後X12仍可鑑別(應然為reject, 1.0.35為命中今日之列或無命中)
function rowsTc() {
    return [
        ['a', 'peter', 1, 1, '#2026-01-01 00:00:00#', -1, 'q', 0],
        ['b', 'Peter', 2, 2, '#2026-06-01 00:00:00#', 0, 'w', 3],
        ['c', 'rose_mary', 3, 3, null, 0, null, null],
        ['d', '100%', null, null, '#2026-10-16 00:00:00#', 0, null, null],
        ['e', null, 5, 5, null, -1, null, null],
        ['f', 'a.c', 2, 2, null, 0, null, null],
        ['g', 'abc', 0, 0, null, 0, null, null],
        ['h', '', -1, -1, null, 0, null, null],
        ['i', 'x[a-c]y', 7, 7, null, 0, null, null],
        ['j', 'a!b', 8, 8, null, 0, null, null],
        ['x_1', 'Rose', 9, 9, null, 0, null, null],
    ]
}


//整數主鍵表tk之資料列: k, id(非主鍵文字欄), v
function rowsTk() {
    return [
        [1, 'a', 1],
        [2, 'B', 2],
        [3, 'c', null],
        [4, null, 4],
        [5, 'e', 5],
    ]
}


const ALL_TC = 'a,b,c,d,e,f,g,h,i,j,x_1'
const ALL_TK = '1,2,3,4,5'


/**
 * 由全部主鍵扣除指定者, 回傳逗號串接之字串
 */
function but(all, ...xs) {
    xs = xs.map((v) => String(v))
    return all.split(',').filter((v) => xs.indexOf(v) < 0).join(',')
}


function q(s) {
    return s === null ? 'NULL' : `'${String(s).replace(/'/g, '\'\'')}'`
}


function num(v) {
    return v === null ? 'NULL' : String(v)
}


//各表之設定: 主鍵欄、讀取主鍵之SQL、主鍵排序
const TABLES = {
    tc: {
        pk: 'id',
        sqlIns: (r) => {
            let [id, name, value, n, dt, b, px, len] = r
            return `INSERT INTO [tc] ([id], [name], [value], [n], [dt], [b], [p$x], [length]) VALUES (${q(id)}, ${q(name)}, ${num(value)}, ${num(n)}, ${dt === null ? 'NULL' : dt}, ${b}, ${q(px)}, ${num(len)})`
        },
        rows: rowsTc,
        sort: (a, b) => (a < b ? -1 : (a > b ? 1 : 0)),
    },
    tk: {
        pk: 'k',
        sqlIns: (r) => {
            let [k, id, v] = r
            return `INSERT INTO [tk] ([k], [id], [v]) VALUES (${num(k)}, ${q(id)}, ${num(v)})`
        },
        rows: rowsTk,
        sort: (a, b) => a - b,
    },
}


/**
 * 建立本測試檔專屬之暫存資料夾、model副本與種子mdb(已寫入資料列), 以及select用之共用副本
 *
 * 註: 各測試檔須用各自之資料夾(./test/temp-find-<組>/), 才可於--parallel下互不干擾
 */
async function setupFind(nm, cl, opt = {}) {
    let fdTmp = `./test/temp-${nm}`
    let fdModels = `${fdTmp}/models`
    let fpSeed = `${fdTmp}/seed.mdb`
    let fpSel = `${fdTmp}/sel.mdb`

    //先清殘留再建
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdModels, { recursive: true })
    let src = fs.readFileSync(`./test/assets/models/${cl}.js`, 'utf8')
    if (typeof opt.patchModel === 'function') {
        src = opt.patchModel(src) //供model與資料表不一致之案(如model多一欄)
    }
    fs.writeFileSync(path.join(fdModels, `${cl}.js`), src, 'utf8')
    fs.copyFileSync('./test/assets/worm_find_def.mdb', fpSeed)

    //rows, 以原生SQL寫入, 存值精確受控
    let tb = TABLES[cl]
    let jet = jetOpen({ path: path.resolve(fpSeed), password: '' })
    let r = await jet.run(tb.rows().map((v) => ({ type: 'execute', sql: tb.sqlIns(v) })))
    if (!r.ok) {
        throw new Error(`seed failed: ${r.error}`)
    }
    fs.copyFileSync(fpSeed, fpSel)

    let ctx = { nm, cl, fdTmp, fdModels, fpSeed, fpSel, nDel: 0 }
    ctx.seedPks = await readPks(ctx, fpSeed)
    return ctx
}


/**
 * 以原生SQL讀取資料表之全部主鍵(排序後)
 */
async function readPks(ctx, fp) {
    let tb = TABLES[ctx.cl]
    let jet = jetOpen({ path: path.resolve(fp), password: '' })
    let rows = await jet.query(`SELECT [${tb.pk}] FROM [${ctx.cl}]`)
    return rows.map((v) => v[tb.pk]).sort(tb.sort)
}


/**
 * 產生實例並收集error事件
 */
function mkW(ctx, fp, ext = {}) {
    let tb = TABLES[ctx.cl]
    let w = wo({ url: 'mdb://:', db: 'worm', cl: ctx.cl, pk: tb.pk, fdModels: ctx.fdModels, storage: fp, ...ext })
    let evs = []
    w.on('error', (e) => {
        evs.push(e)
    })
    return { w, evs }
}


/**
 * 執行一列案例並斷言
 *
 * 斷言(CLAUDE_rulebook.md R-FIND〈對應測試〉):
 *   1. select命中之主鍵 = exp; exp為'REJECT'者reject且發一次error事件, 其餘不發error事件
 *   2. delAll於種子之新複本恰刪exp之列, 且n = nDeleted = 實刪列數(系列最低要求①: select命中即delAll刪除);
 *      exp為'REJECT'者reject、發一次error事件且資料表不變(系列最低要求②③)
 *
 *   3. 案例給rej(正規式)者, 兩函數之reject訊息須符合之(核對拒收原因, 不因他因reject而綠)
 *
 * @param {Object} ctx 輸入setupFind之回傳
 * @param {Object} c 輸入案例{key, find:()=>條件, exp, noArg, rej, wopt}, wopt為額外之建構設定(如另指定pk)
 */
async function runCase(ctx, c) {
    let tb = TABLES[ctx.cl]
    let isRej = c.exp === 'REJECT'

    //select
    {
        let { w, evs } = mkW(ctx, ctx.fpSel, c.wopt)
        let got
        let msg = ''
        try {
            let rs = c.noArg ? await w.select() : await w.select(c.find())
            got = rs.map((v) => v[tb.pk]).sort(tb.sort).join(',')
        }
        catch (e) {
            got = 'REJECT'
            msg = String((e && e.message) || e)
        }
        assert.strict.strictEqual(got, c.exp, `select ${c.key}${msg ? ' (' + msg + ')' : ''}`)
        assert.strict.strictEqual(evs.length, isRej ? 1 : 0, `select ${c.key} error事件數`)
        if (isRej && c.rej) {
            assert.strict.match(msg, c.rej, `select ${c.key} 拒收原因`)
        }
    }

    //delAll, 於種子之新複本
    {
        ctx.nDel++
        let fp = `${ctx.fdTmp}/del-${ctx.nDel}.mdb`
        fs.copyFileSync(ctx.fpSeed, fp)
        let { w, evs } = mkW(ctx, fp, c.wopt)
        let res
        let msg = ''
        try {
            res = c.noArg ? await w.delAll() : await w.delAll(c.find())
        }
        catch (e) {
            res = 'REJECT'
            msg = String((e && e.message) || e)
        }
        let after = await readPks(ctx, fp)
        let deleted = ctx.seedPks.filter((v) => after.indexOf(v) < 0)
        if (isRej) {
            assert.strict.strictEqual(res, 'REJECT', `delAll ${c.key} 應reject, 實刪[${deleted.join(',')}]`)
            assert.strict.strictEqual(deleted.length, 0, `delAll ${c.key} reject時不得刪除任何列`)
            assert.strict.strictEqual(evs.length, 1, `delAll ${c.key} error事件數`)
            if (c.rej) {
                assert.strict.match(msg, c.rej, `delAll ${c.key} 拒收原因`)
            }
        }
        else {
            assert.strict.notStrictEqual(res, 'REJECT', `delAll ${c.key} 不應reject (${msg})`)
            assert.strict.strictEqual(deleted.join(','), c.exp, `delAll ${c.key} 實刪之列`)
            assert.strict.deepStrictEqual(res, { n: deleted.length, nDeleted: deleted.length, ok: 1 }, `delAll ${c.key} 回傳`)
            assert.strict.strictEqual(evs.length, 0, `delAll ${c.key} error事件數`)
        }
        fs.rmSync(fp, { force: true })
    }
}


export { ALL_TC, ALL_TK, but, setupFind, runCase }
