import fs from 'fs'
import path from 'path'
import assert from 'assert'
import cloneDeep from 'lodash-es/cloneDeep.js'
import wfCases from 'wsemi/src/_cvOrmStrCases.mjs'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'


//unit-wf*之共用層: 系列字串良構檢核契約案例表(wsemi/src/_cvOrmStrCases.mjs)逐案對公開API之測試
//註: 本檔不含測試案例, 不符mocha之test/*.test.mjs而不被當成測試檔載入
//註: 規則見CLAUDE_rulebook.md之R-WF(dspec〈一之三〉9., 第66項批2)
//註: 案例表之資料表twf由test/assets/worm_wf_def.mdb提供(node toolg/genTestMdbAssets.mjs worm_wf_def.mdb): id TEXT(255) PK, name MEMO
//註: 案例表API層1305案, 其中gfs(GridFS)150案與doc(固定欄位後端無從[接受後讀回]巢狀結構與任意鍵名)200案本套件略過(this.skip(), 拒收案全數照跑),
//    再加autoGenPk為false之整輪(id、single、val、order四組)與useStable為false之子集(toctou、order兩組), 逐案各約1.5秒,
//    分成6個測試檔(unit-wf1~6.test.mjs, 以工作序號mod 6分配)令mocha --parallel並行


const N_SLICE = 6 //測試檔份數
const FILE_FD_TMP = (nm) => `./test/temp-${nm}`

//rounds: 同一份案例表依選項重跑; 檢核不隨autoGenPk改變(dspec〈一之三〉9.), 故id、single、val、order四組以autoGenPk為false再跑一輪;
//useStable為false時各函數不經佇列而直接執行(snap同樣於呼叫當下複製), 取toctou與order子集
const ROUNDS = [
    { nm: 'g1', ext: {}, groups: null },
    { nm: 'g0', ext: { autoGenPk: false }, groups: ['id', 'single', 'val', 'order'] },
    { nm: 'ns', ext: { useStable: false }, groups: ['toctou', 'order'] },
]

const mk = (id, extra) => ({ id, name: 'n', ...extra })

const msgOf = (err) => (err instanceof Error ? err.message : String(err))


/**
 * 取案例表API層(group不為str與data)之工作清單: 每項{round, c}, 略過者(gfs、doc)亦在內以便計數
 */
function getJobs() {
    let cs = wfCases.cases.filter((v) => v.group !== 'str' && v.group !== 'data')
    let jobs = []
    for (let r of ROUNDS) {
        for (let c of cs) {
            if (r.groups === null || r.groups.includes(c.group)) {
                jobs.push({ round: r, c })
            }
        }
    }
    return jobs
}


/**
 * 案例是否本套件不適用(略過)
 */
function isSkipped(c) {
    return c.need.includes('gfs') || c.need.includes('doc')
}


/**
 * 斷言actual含part之每個鍵且深度全等
 */
function assertPartial(actual, part, tag) {
    assert.strict.ok(actual !== null && actual !== undefined, `${tag}: 列不存在`)
    for (let [k, v] of Object.entries(part)) {
        assert.strict.deepStrictEqual(actual[k], v, `${tag}: 欄位[${k}]`)
    }
}


/**
 * 建立本測試檔專屬之暫存資料夾與model副本
 */
function setupWf(nm) {
    let fdTmp = FILE_FD_TMP(nm)
    let fdModels = `${fdTmp}/models`
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdModels, { recursive: true })
    for (let fn of ['twf.js', 'twfk.js']) {
        fs.copyFileSync(`./test/assets/models/${fn}`, path.join(fdModels, fn))
    }
    return { nm, fdTmp, fdModels, n: 0 }
}


/**
 * 取一個全新之後端(複製空表資產至新檔), 並記錄事件之發生順序
 */
function freshWo(ctx, ext = {}, asset = './test/assets/worm_wf_def.mdb') {
    ctx.n++
    let fp = `${ctx.fdTmp}/c${ctx.n}.mdb`
    fs.copyFileSync(asset, fp)
    let base = { url: 'mdb://:', db: 'worm', cl: 'twf', pk: 'id', fdModels: ctx.fdModels, storage: fp }
    let w = wo({ ...base, ...ext })
    let ev = { error: [], change: [], order: [] }
    w.on('error', (mode, data, err) => {
        ev.error.push({ mode, data, err })
        ev.order.push('error')
    })
    w.on('change', (mode, data, res) => {
        ev.change.push({ mode, data, res })
        ev.order.push('change')
    })
    return { w, ev, fp, base: { ...base, ...ext } }
}


/**
 * 單一案例(依案例表契約逐項斷言, 見wsemi/src/_cvOrmStrCases.mjs檔頭)
 *
 * 註: 除案例表之斷言外, 另斷言: 整批reject時error事件恰一次且不發change、逐筆失敗時error事件數等於失敗筆數、
 * 失敗之呼叫不改動呼叫端傳入之物件(toctou組除外, 其args含存取器且本身即模擬呼叫端改動)
 */
async function runCase(ctx, job, self) {
    let { round, c } = job
    if (isSkipped(c)) {
        return self.skip()
    }
    let e = c.expect
    let tag = `${round.nm}:${c.id}`

    //new, 建構設定
    if (c.api === 'new') {
        let { base } = freshWo(ctx, round.ext)
        let args = c.args(mk, base)
        let thrown = null
        try {
            wo(args[0])
        }
        catch (err) {
            thrown = err
        }
        assert.strict.ok(thrown !== null, `${tag}: 建構須throw [行為]`)
        assert.strict.strictEqual(msgOf(thrown), e.msg, `${tag}: 建構throw之訊息 [詞彙]`)
        return
    }

    let { w, ev, base } = freshWo(ctx, round.ext)
    await w.insertBulk(c.pre(mk))
    ev.error.length = 0
    ev.change.length = 0
    ev.order.length = 0

    //before, 呼叫前之全表(unchanged比對用)
    let before = {}
    if ((e.unchanged || []).length > 0) {
        for (let v of await w.select()) {
            before[v.id] = v
        }
    }

    let args = c.args(mk, base)
    let isToctou = c.group === 'toctou'
    let argsCopy = isToctou ? null : cloneDeep(args)

    //call
    let r = null
    let rej = null
    try {
        let p = w[c.api](...args)
        if (c.afterCall) {
            c.afterCall(args)
        }
        r = await p
    }
    catch (err) {
        rej = err
    }

    if (e.kind === 'free') {
        if (rej) {
            assert.strict.ok(!new RegExp(e.notMsg).test(msgOf(rej)), `${tag}: 值或鍵名之NUL不得以共用檢核之詞彙拒收, 實為[${msgOf(rej)}]`)
        }
        else if (Array.isArray(r)) {
            for (let x of r) {
                if (x.ok === 0) {
                    assert.strict.ok(!new RegExp(e.notMsg).test(x.err), `${tag}: 逐筆err不得以共用檢核之詞彙拒收, 實為[${x.err}]`)
                }
            }
        }
    }
    else if (e.kind === 'rejectAll') {
        assert.strict.ok(rej, `${tag}: 須整批reject [行為]`)
        assert.strict.strictEqual(msgOf(rej), e.msg, `${tag}: reject訊息 [詞彙]`)
        assert.strict.deepStrictEqual(ev.order, ['error'], `${tag}: 須於reject前恰發出一次error事件且不發change [事件]`)
        assert.strict.strictEqual(ev.error[0].mode, c.api, `${tag}: error事件之操作別`)
    }
    else {
        assert.strict.ok(!rej, `${tag}: 不得reject (${rej ? msgOf(rej) : ''}) [行為]`)
        if (e.kind === 'null') {
            assert.strict.strictEqual(r, null, `${tag}: 須回null [行為]`)
            assert.strict.deepStrictEqual(ev.order, [], `${tag}: selectByPk回null不得發事件`)
        }
        if (e.kind === 'itemErr') {
            let nIn = Array.isArray(args[0]) ? args[0].length : 1
            assert.strict.strictEqual(r.length, nIn, `${tag}: 回傳須與輸入等長`)
            r.forEach((x, i) => {
                if (e.bad.includes(i)) {
                    let msg = e.msgs ? e.msgs[e.bad.indexOf(i)] : e.msg
                    assert.strict.strictEqual(x.ok, 0, `${tag}: 第${i}筆須ok為0 [行為]`)
                    assert.strict.strictEqual(x.err, msg, `${tag}: 第${i}筆err為固定詞彙 [詞彙]`)
                    //結果形狀: 本套件save之失敗筆為{n:1,nInserted:0,nModified:0,ok:0,err}, del為{n:0,nDeleted:0,ok:0,err}
                    let shape = c.api === 'del'
                        ? { n: 0, nDeleted: 0, ok: 0, err: msg }
                        : { n: 1, nInserted: 0, nModified: 0, ok: 0, err: msg }
                    assert.strict.deepStrictEqual(x, shape, `${tag}: 第${i}筆失敗結果之形狀 [行為]`)
                }
                else {
                    assert.strict.strictEqual(x.ok, 1, `${tag}: 第${i}筆須照常處理 [行為]`)
                }
            })
            assert.strict.strictEqual(ev.error.length, e.bad.length, `${tag}: 逐筆失敗須各發一次error事件 [事件]`)
            assert.strict.strictEqual(ev.error.filter((v) => v.mode === c.api).length, e.bad.length, `${tag}: error事件之操作別`)

            //整批change: 逐筆事件之後恰發出一次, 且為最後一個事件, 其res即回傳值
            let chs = ev.change.filter((v) => v.mode === c.api)
            assert.strict.strictEqual(chs.length, 1, `${tag}: 整批change須恰發出一次 [事件]`)
            assert.strict.strictEqual(ev.order[ev.order.length - 1], 'change', `${tag}: 整批change須為最後一個事件 [事件]`)
            assert.strict.strictEqual(ev.change[ev.change.length - 1].mode, c.api, `${tag}: 最後一個change之操作別 [事件]`)
            assert.strict.deepStrictEqual(chs[0].res, r, `${tag}: 整批change之結果須等於回傳值 [事件]`)

            //逐筆insert事件(僅save): 數量須等於nInserted為1之筆數, 且不得有他種操作別之change
            let insChs = ev.change.filter((v) => v.mode === 'insert')
            assert.strict.strictEqual(insChs.length, c.api === 'save' ? r.filter((x) => x.nInserted === 1).length : 0, `${tag}: 逐筆insert事件數須等於nInserted為1之筆數 [事件]`)
            assert.strict.strictEqual(ev.change.length, chs.length + insChs.length, `${tag}: 不得有其他操作別之change事件 [事件]`)
            //每個insert事件須對應回傳陣列中nInserted為1之那一筆(依輸入索引遞增), 結果全等於該筆回傳值, 資料為該筆之列(主鍵相同)
            let insIdx = r.map((x, i) => (x.nInserted === 1 ? i : -1)).filter((i) => i >= 0)
            insChs.forEach((x, j) => {
                let i = insIdx[j]
                assert.strict.deepStrictEqual(x.res, r[i], `${tag}: insert事件(第${j}個)之結果須全等於第${i}筆之回傳值 [事件]`)
                let src = Array.isArray(args[0]) ? args[0][i] : args[0]
                assert.strict.strictEqual(x.data.length, 1, `${tag}: insert事件之data須為單筆陣列 [事件]`)
                assert.strict.strictEqual(x.data[0].id, src.id, `${tag}: insert事件之data須為第${i}筆之列 [事件]`)
            })
        }
        if (e.kind === 'ok') {
            if (/^insert/.test(c.api)) {
                assert.strict.strictEqual(r.ok, 1, `${tag}: insert須ok為1`)
            }
            assert.strict.strictEqual(ev.error.length, 0, `${tag}: 成功不得發error事件`)
            if (e.result) {
                assertPartial(r, e.result, tag)
            }
        }
    }

    //caller, 失敗之呼叫不改動呼叫端傳入之物件
    if (!isToctou && (rej || e.kind === 'itemErr')) {
        assert.strict.deepStrictEqual(args, argsCopy, `${tag}: 呼叫端傳入之物件不得被改動`)
    }

    //after, 呼叫後之全表
    if (e.ids || e.rows || (e.unchanged || []).length > 0) {
        let rows = await w.select()
        let byId = {}
        for (let v of rows) {
            byId[v.id] = v
        }
        if (e.ids) {
            assert.strict.deepStrictEqual(rows.map((v) => v.id).sort(), e.ids, `${tag}: 呼叫後之全部id [狀態]`)
        }
        for (let id of (e.unchanged || [])) {
            assert.strict.deepStrictEqual(byId[id], before[id], `${tag}: 列[${id}]須維持原樣 [狀態]`)
        }
        for (let [id, part] of Object.entries(e.rows || {})) {
            assertPartial(byId[id], part, `${tag}: 列[${id}]`)
        }
    }
}


/**
 * 定義第slice份(0起算)測試
 */
function defineWf(slice) {
    if (!isWindows()) {
        return
    }
    let nm = `wf${slice + 1}`
    let jobs = getJobs().filter((v, i) => i % N_SLICE === slice)
    describe(`WOrmMdb 字串良構案例表(第${slice + 1}/${N_SLICE}份, ${jobs.length}案)`, function() {
        let ctx = null

        before(function() {
            ctx = setupWf(nm)
        })

        after(function() {
            cleanStorage(FILE_FD_TMP(nm))
        })

        for (let job of jobs) {
            it(`${job.round.nm}:${job.c.id} ${job.c.label}`, async function() {
                await runCase(ctx, job, this)
            })
        }
    })
}


export { N_SLICE, ROUNDS, mk, msgOf, getJobs, isSkipped, assertPartial, setupWf, freshWo, defineWf, wfCases }
