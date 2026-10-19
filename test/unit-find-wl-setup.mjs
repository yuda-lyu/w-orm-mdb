import fs from 'fs'
import path from 'path'
import assert from 'assert'
import wlCases from 'wsemi/src/_cvOrmFindCases.mjs'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'


//unit-find-wl*之共用層: 系列條件白名單案例表(wsemi/src/_cvOrmFindCases.mjs, 255案)逐案對公開select/delAll之測試
//註: 本檔不含測試案例, 不符mocha之test/*.test.mjs而不被當成測試檔載入
//註: 規則見CLAUDE_rulebook.md之R-WL(dspec〈一之三〉, 本套件呼叫cvOrmFind({ maxIn: 2000, maxList: 999 }))
//註: 案例表之資料表tw由test/assets/worm_wl_def.mdb提供(node toolg/genTestMdbAssets.mjs worm_wl_def.mdb), 種子取自案例表之seed()
//註: 案例表255案逐案各約1秒, 分成4個測試檔(unit-find-wl1~4.test.mjs, 以案例序號mod 4分配)令mocha --parallel並行


const MAX_IN = 2000 //本套件之$in/$nin上限(R-WL-00)
const RE_SCHEMA_REJ = /unknown column name|unsupported column name|does not match column type/ //後端轉譯層(w-orm-reladb之cvFind)對欄位名與值型別之拒收詞彙
const WHY_ARRBIG = 'array is too large' //cvOrmFind對$in/$nin超過maxIn之原因詞彙(wsemi/src/_cvOrmFindCases.mjs之W.arrbig)


//本地時間之Jet日期常值: Jet之DATETIME無時區, 與src/getCmd.mjs寫入時一致取本地時間分量
function jetDate(d) {
    let p = (n) => String(n).padStart(2, '0')
    return `#${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}#`
}

function q(s) {
    return `'${String(s).replace(/'/g, '\'\'')}'`
}


/**
 * 種子列(案例表seed()之一列)轉為INSERT語句, 以原生SQL寫入令存值精確受控; undefined與null之欄不寫入(Jet為NULL, YESNO欄為false)
 */
function sqlSeed(row) {
    let cols = []
    let vals = []
    for (let [k, v] of Object.entries(row)) {
        if (v === undefined || v === null) {
            continue
        }
        cols.push(`[${k}]`)
        if (v instanceof Date) {
            vals.push(jetDate(v))
        }
        else if (typeof v === 'boolean') {
            vals.push(v ? '-1' : '0')
        }
        else if (typeof v === 'number') {
            vals.push(String(v))
        }
        else {
            vals.push(q(v))
        }
    }
    return `INSERT INTO [tw] (${cols.join(', ')}) VALUES (${vals.join(', ')})`
}


/**
 * 建立本測試檔專屬之暫存資料夾、model副本與種子mdb(以案例表seed()寫入)
 *
 * 註: 各測試檔須用各自之資料夾(./test/temp-<nm>/), 才可於--parallel下互不干擾
 */
async function setupWl(nm) {
    let fdTmp = `./test/temp-${nm}`
    let fdModels = `${fdTmp}/models`
    let fpSeed = `${fdTmp}/seed.mdb`
    let fpSel = `${fdTmp}/sel.mdb`

    //先清殘留再建
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdModels, { recursive: true })
    fs.copyFileSync('./test/assets/models/tw.js', path.join(fdModels, 'tw.js'))
    fs.copyFileSync('./test/assets/worm_wl_def.mdb', fpSeed)

    //rows
    let jet = jetOpen({ path: path.resolve(fpSeed), password: '' })
    let r = await jet.run(wlCases.seed().map((v) => ({ type: 'execute', sql: sqlSeed(v) })))
    if (!r.ok) {
        throw new Error(`seed failed: ${r.error}`)
    }
    fs.copyFileSync(fpSeed, fpSel)

    let ctx = { nm, fdTmp, fdModels, fpSeed, fpSel, nDel: 0 }
    ctx.seedIds = await readIds(fpSeed)
    return ctx
}


/**
 * 以原生SQL讀取資料表之全部id(排序後)
 */
async function readIds(fp) {
    let jet = jetOpen({ path: path.resolve(fp), password: '' })
    let rows = await jet.query('SELECT [id] FROM [tw]')
    return rows.map((v) => v.id).sort()
}


/**
 * 產生實例並記錄事件之發生順序
 *
 * @returns {Object} {w, order, count(name)}, order為事件與settle之順序陣列
 */
function mkW(ctx, fp, ext = {}) {
    let w = wo({ url: 'mdb://:', db: 'worm', cl: 'tw', pk: 'id', fdModels: ctx.fdModels, storage: fp, ...ext })
    let order = []
    w.on('error', () => {
        order.push('error')
    })
    w.on('change', () => {
        order.push('change')
    })
    let count = (nm) => order.filter((v) => v === nm).length
    return { w, order, count }
}


/**
 * 執行一個呼叫並記錄結果與事件順序
 *
 * @returns {Object} {ok, res, msg, order}
 */
async function call(env, fn) {
    let out = { ok: false, res: null, msg: '', order: env.order }
    try {
        out.res = await fn(env.w)
        out.ok = true
        env.order.push('resolve')
    }
    catch (e) {
        out.msg = String((e && e.message) || e)
        env.order.push('reject')
    }
    return out
}


/**
 * 同一find先後執行select(共用之唯讀副本)與delAll(種子之新複本), 回傳兩者之結果與delAll實刪之id
 *
 * @param {Object} ctx 輸入setupWl之回傳
 * @param {Function} mkFind 輸入函數, 每次呼叫回傳全新之find值(含Date、Symbol、Proxy等不可共用者)
 * @param {Object} [ext={}] 輸入建構WOrmMdb時額外之設定
 * @returns {Object} {s, d, deleted, sIds}, s與d為call之回傳, deleted為delAll實刪之id(排序後), sIds為select命中之id(排序後, reject為null)
 */
async function runBoth(ctx, mkFind, ext = {}) {

    //select, 於共用之唯讀副本
    let s = await call(mkW(ctx, ctx.fpSel, ext), (w) => w.select(mkFind()))

    //delAll, 於種子之新複本
    ctx.nDel++
    let fp = `${ctx.fdTmp}/del-${ctx.nDel}.mdb`
    fs.copyFileSync(ctx.fpSeed, fp)
    let d = await call(mkW(ctx, fp, ext), (w) => w.delAll(mkFind()))
    let after = await readIds(fp)
    let deleted = ctx.seedIds.filter((v) => after.indexOf(v) < 0)
    fs.rmSync(fp, { force: true })

    let sIds = s.ok ? s.res.map((v) => v.id).sort() : null
    return { s, d, deleted, sIds }
}


/**
 * 取案例對mdb之應然
 *
 * 註: REJ → 'REJ'; OK/ALL且need.maxIn > MAX_IN → 'REJ'(原因array is too large; dspec〈一之三〉6. 之maxIn 2000);
 * OK/ALL且schema → 'SCHEMA'(可reject或回ids.sql, 但select與delAll須同判); 其餘 'OK'
 * 註: ids取ids.mdb覆寫(僅N08、E25; Jet布林欄無NULL、字串等值不分大小寫), 無則ids.sql(SQL三值; 案例表註解)
 */
function expOf(c) {
    if (c.expect === 'REJ') {
        return { kind: 'REJ', why: c.why }
    }
    if (c.need && c.need.maxIn > MAX_IN) {
        return { kind: 'REJ', why: WHY_ARRBIG }
    }
    let ids = [...(c.ids.mdb !== undefined ? c.ids.mdb : c.ids.sql)].sort()
    return { kind: c.schema ? 'SCHEMA' : 'OK', ids }
}


/**
 * 執行一案並斷言(CLAUDE_rulebook.md R-WL-04 之 1、2)
 *
 *   對應dspec〈一之三〉與審計方案 §7.1:
 *   - OK/ALL: select(find)命中 = 預期ids(依族別: mdb覆寫 ?? sql); delAll於種子之新複本刪除之集合 = select命中之集合, n = nDeleted = 實刪列數(系列最低要求①); 不發error事件
 *   - REJ: select與delAll皆reject、訊息以'invalid find: '開頭且含原因詞彙、資料表不變(最低要求②③)、error事件於reject前恰一次、change不發
 *   - SCHEMA: 可因欄位不存在或欄位型別檢核reject(後端轉譯層)或回ids.sql, 但select與delAll須同判
 */
async function runWl(ctx, c) {
    let exp = expOf(c)
    let { s, d, deleted, sIds } = await runBoth(ctx, c.find)
    let sEnv = s.order

    let tag = `${c.id} ${c.label}`

    if (exp.kind === 'REJ') {
        assert.strict.strictEqual(s.ok, false, `${tag} select應reject`)
        assert.strict.strictEqual(d.ok, false, `${tag} delAll應reject, 實刪[${deleted.join(',')}]`)
        assert.strict.strictEqual(deleted.length, 0, `${tag} delAll reject時不得刪除任何列`)
        for (let [nm, r] of [['select', s], ['delAll', d]]) {
            assert.strict.ok(r.msg.startsWith('invalid find: '), `${tag} ${nm}訊息須以invalid find: 開頭, 實為[${r.msg.slice(0, 120)}]`)
            assert.strict.ok(r.msg.includes(exp.why), `${tag} ${nm}訊息須含[${exp.why}], 實為[${r.msg.slice(0, 120)}]`)
            assert.strict.deepStrictEqual(r.order, ['error', 'reject'], `${tag} ${nm}須於reject前恰發出一次error事件, 且不發change`)
        }
        return
    }

    if (exp.kind === 'SCHEMA' && !s.ok) {
        assert.strict.strictEqual(d.ok, false, `${tag} select reject而delAll未reject(違反最低要求①)`)
        assert.strict.strictEqual(deleted.length, 0, `${tag} delAll reject時不得刪除任何列`)
        for (let [nm, r] of [['select', s], ['delAll', d]]) {
            assert.strict.ok(r.msg.startsWith('invalid find: '), `${tag} ${nm}訊息須以invalid find: 開頭, 實為[${r.msg.slice(0, 120)}]`)
            //SCHEMA案僅可因後端轉譯層(欄位名不在model或資料表、值與欄位型別不符)reject; 不得因形狀層(cvOrmFind)或castPkFind改寫(空子式、深度、節點)而reject(外審opus F7)
            assert.strict.ok(RE_SCHEMA_REJ.test(r.msg), `${tag} ${nm}須為後端轉譯層之拒收原因, 實為[${r.msg.slice(0, 120)}]`)
            assert.strict.deepStrictEqual(r.order, ['error', 'reject'], `${tag} ${nm}須於reject前恰發出一次error事件, 且不發change`)
        }
        return
    }

    //OK、ALL與SCHEMA且未reject
    assert.strict.strictEqual(s.ok, true, `${tag} select不應reject (${s.msg})`)
    assert.strict.strictEqual(d.ok, true, `${tag} delAll不應reject (${d.msg})`)
    assert.strict.deepStrictEqual(sIds, exp.ids, `${tag} select命中`)
    assert.strict.deepStrictEqual(deleted, sIds, `${tag} delAll刪除之集合須等於select命中之集合`)
    assert.strict.deepStrictEqual(d.res, { n: deleted.length, nDeleted: deleted.length, ok: 1 }, `${tag} delAll回傳`)
    assert.strict.deepStrictEqual(sEnv, ['resolve'], `${tag} select不發任何事件`)
    assert.strict.deepStrictEqual(d.order, ['change', 'resolve'], `${tag} delAll僅發一次change, 不發error`)
}


/**
 * 定義第shard個測試檔(共nShard個)之案例
 */
function defineWl(shard, nShard) {
    let nm = `find-wl${shard + 1}`
    let cases = wlCases.cases.filter((c, i) => i % nShard === shard)

    if (isWindows()) {
        describe(`WOrmMdb find whitelist案例表(${shard + 1}/${nShard}, ${cases.length}案)`, function() {

            let ctx = null

            before(async function() {
                ctx = await setupWl(nm)
            })

            after(function() {
                cleanStorage(`./test/temp-${nm}`)
            })

            for (let c of cases) {
                it(`${c.id} ${c.label}`, async function() {
                    await runWl(ctx, c)
                })
            }

        })
    }
}


export { MAX_IN, WHY_ARRBIG, setupWl, readIds, mkW, call, runBoth, expOf, runWl, defineWl, wlCases }
