import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import Sequelize from 'sequelize'
import diagCases from 'wsemi/src/_diagCases.mjs'
import genDiagFunLog from 'wsemi/src/genDiagFunLog.mjs'
import { importSrc } from './tools/srcDir.mjs'
import { isWindows } from './unit-setup.mjs'


//spec: sgud/rule/rulebook.md 之 R-DIAG-13(主控dspec〈診斷輸出與遮罩〉D3、設計§6.5、wsemi之R-DIAG-01): 對外錯誤值之接線(真Jet引擎)
//  ①共用語料(wsemi/src/_diagCases.mjs)之wire案經本套件之站點重跑: 外來值由change訂閱函數拋出(emitChange之catch → 診斷細節), 或由呼叫端數據之getter於整批流程中拋出(→ 整批reject與error事件)
//  ②外來值(Jet引擎與connMDB.exe之錯誤文字、執行檔之取得失敗、sequelize之錯誤、呼叫端數據之getter)含憑證者: 七函數與createStorage之整批reject、error事件之訊息、逐筆err皆不含憑證(含***),
//    整批reject之Error為副本(instanceof同類), 不含憑證者為原值; 單獨帳號與儲存路徑不遮(dspec Q3)
//  ③本套件之固定詞彙(invalid find…、invalid id…、invalid data…、can not import model…)原樣: 密碼恰為其子字串時亦不被切碎(語料R07), 同實例之外來錯誤仍遮(對照)
//  ④宣告: paths(資料庫檔案路徑, 只用於診斷細節)、patterns(mdbUrl)、mdb之無主機連線字串之@後片段(畸形網址片段)
//外來值之造法: Jet之「找不到資料表」訊息回顯表名, 故以含憑證字樣之表名(model存在而資料表不存在)取得含憑證之Jet錯誤文字; 控制組(表名同、密碼不同)證明Jet確實回顯


let { cases, mkCtx, verify } = diagCases
let SEC = diagCases.secrets() //{ url, username: 'dbuser', password: 'Pw9xQ!z7', ... }

let fdTmp = './test/temp-diaglog-wire'
let fdModels = `${fdTmp}/models`
let fpStorage = `${fdTmp}/wire.mdb`

const URL_C = `mdb://${SEC.username}:${SEC.password}` //語料之帳密
const PW = 'Zsecret9'
const USER = 'Zuser9'
const URL_X = `mdb://${USER}:${PW}`
const URL_Y = `mdb://${USER}:Other77x`
const CL_X = 'tZsecret9q' //model存在、資料表不存在: Jet之錯誤文字回顯表名(含密碼字樣)
const CL_U = 'tZuser9q' //表名含帳號字樣(帳號單獨出現不屬憑證, 對外值不遮)


let mk = (url, cl, ext = {}) => {
    return wo({ url, db: 'worm', cl, fdModels, storage: fpStorage, ...ext })
}
let wo = null


//settle, 取resolve值或reject值(原值, 不轉字串)
let settle = async (pm) => {
    try {
        return { ok: await pm }
    }
    catch (err) {
        return { err }
    }
}


//msgOf, 對外值之文字(Error取message)
let msgOf = (v) => (v instanceof Error ? v.message : String(v))


//noPw, 字串不含密碼與帳號:密碼(pw預設為PW)
let noPw = (s, msg = '', pw = PW, user = USER) => {
    for (let x of [pw, `${user}:${pw}`]) {
        assert.ok(String(s).indexOf(x) < 0, `${msg}含憑證[${x}]: ${String(s).slice(0, 300)}`)
    }
}


//withEvents, 收集實例之error事件(mode, data, msg)
let withEvents = (w) => {
    let evs = []
    w.on('error', (m, d, e) => evs.push([m, d, e]))
    return evs
}


//capRaw, 擷取console.log與console.error之原始引數
let capRaw = async (fn) => {
    let rs = []
    let ol = console.log
    let oe = console.error
    console.log = (...args) => rs.push({ m: 'log', args })
    console.error = (...args) => rs.push({ m: 'error', args })
    try {
        await fn()
    }
    finally {
        console.log = ol
        console.error = oe
    }
    return rs
}


let seq = 0


//viaListener, 外來值v由change訂閱函數拋出(emitChange之catch站點) → funLog收到之(label, safe, detail)
let viaListener = async (v, ext = {}) => {
    let got = []
    let w = mk(URL_C, 'users', { funLog: (...a) => got.push(a), ...ext })
    w.on('change', () => {
        throw v
    })
    let r = await w.insert({ id: `L${seq++}`, name: 'n' })
    assert.deepStrictEqual(r, { n: 1, nInserted: 1, ok: 1 })
    let g = got.filter((x) => x[0] === 'change handler threw')
    assert.strictEqual(g.length, 1, JSON.stringify(got.map((x) => x[0])))
    return { safe: g[0][1], detail: g[0][2], n: g[0].length }
}


//rowThrow, 類別實例之一列: 原型上之getter(k)拋出v; 快照(flatRow)時之拋錯延後至該欄被讀取時(主鍵於預檢chkWf, 其餘欄於整批流程內產生寫入語句時)
//自有之value令快照前之[無資料]判定為非空(只有原型getter之實例視同空物件而不處理)
let rowThrow = (k, v, id) => {
    class Row {
        constructor() {
            this.value = 1
            if (k !== 'id') {
                this.id = id
            }
        }
    }
    Object.defineProperty(Row.prototype, k, {
        get() {
            throw v
        },
        configurable: true,
    })
    return new Row()
}


//viaBatch, 外來值v由呼叫端數據之name欄getter於insert之整批流程中拋出 → reject值與error事件
let viaBatch = async (v, url = URL_C, fn = 'insert') => {
    let w = mk(url, 'users')
    let evs = withEvents(w)
    let id = `B${seq++}`
    let row = rowThrow('name', v, id)
    let r = await settle(w[fn](fn === 'insertBulk' ? [row] : row))
    assert.ok(Object.prototype.hasOwnProperty.call(r, 'err'), `${fn}應reject`)
    assert.strictEqual(evs.length, 1, `${fn}應發出一次error事件`)
    return { r: r.err, evs, id }
}


//WIRE_APPLIED, 經本套件站點重跑之語料案; WIRE_NA, 不適用(理由)
let WIRE_APPLIED = ['T01', 'T07', 'K01', 'K09', 'V02', 'E01', 'E07', 'P01', 'S07', 'C01', 'R01', 'R04', 'R07', 'R11', 'R12', 'O01', 'A07']
let WIRE_NA = {
    R02: '需兩組網址(畸形之pg網址與語料之url)為秘密來源; 本套件之秘密來源只有單一opt.url(mdb://帳號:密碼, 無主機), 改以本套件之同型案(mdb無主機連線字串之@後片段)驗證, 見〈宣告〉',
    O15: 'safe之鍵皆為本套件固定之stmt、mode、name、type與errType、errCode, 無呼叫端可控之鍵(原始碼盤點鎖定於unit-diaglog)',
    A01: 'genDiagFunLog自身不讀第3引數之行為; 經本套件之路徑即A07接線(getDetail不被呼叫, 細節不產生)',
}


if (isWindows()) {

    describe('diaglog wire(R-DIAG接線, 真Jet)', function() {

        this.timeout(180000)

        before(async function() {
            wo = (await importSrc('WOrmMdb.mjs')).default
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdModels, { recursive: true })
            fs.copyFileSync('./test/assets/worm_def.mdb', fpStorage)
            let src = fs.readFileSync('./models/users.js', 'utf8')
            fs.writeFileSync(`${fdModels}/users.js`, src, 'utf8')
            for (let cl of [CL_X, CL_U, 'tinvalidq']) {
                fs.writeFileSync(`${fdModels}/${cl}.js`, src.split('users').join(cl), 'utf8')
            }
        })

        after(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
        })


        describe('共用語料之wire案', function() {

            it('語料之wire案皆已分類(適用或不適用附理由): 語料新增wire案時此處失敗而須歸類', function() {
                let ids = cases.filter((c) => c.wire === true).map((c) => c.id).sort()
                assert.deepStrictEqual([...WIRE_APPLIED, ...Object.keys(WIRE_NA)].sort(), ids)
            })

            for (let id of ['T01', 'T07', 'K01', 'K09', 'V02', 'E01', 'E07', 'P01', 'S07']) {
                it(`${id} 外來值由change訂閱函數拋出 → funLog之detail符合語料期望(遮罩、不執行使用端程式)`, async function() {
                    let c = cases.find((x) => x.id === id)
                    let ctx = mkCtx({ util: true, isNativeError: util.types.isNativeError })
                    let { detail, n } = await viaListener(c.make(ctx))
                    assert.strictEqual(n, 3, 'funLog應收到detail')
                    assert.strictEqual(verify(c, detail, ctx), null)
                })
            }

            it('C01 錯誤代碼ECONNREFUSED、EAI_AGAIN、E2BIG經change訂閱函數拋出 → safe之errCode照列', async function() {
                let c = cases.find((x) => x.id === 'C01')
                let ctx = mkCtx({ util: true })
                let out = []
                for (let e of c.make(ctx)) {
                    let { safe } = await viaListener(e)
                    assert.strictEqual(safe.mode, 'insert')
                    out.push({ errType: safe.errType, errCode: safe.errCode })
                }
                assert.strictEqual(verify(c, out, ctx), null)
            })

            it('R01 不含憑證之外來錯誤由數據之getter拋出 → insert之reject為同一物件, error事件為其訊息', async function() {
                let c = cases.find((x) => x.id === 'R01')
                let ctx = mkCtx({ util: true })
                let e = c.make(ctx)
                let { r, evs } = await viaBatch(e)
                assert.strictEqual(verify(c, [e, r], ctx), null)
                assert.strictEqual(evs[0][0], 'insert')
                assert.strictEqual(evs[0][2], 'timeout')
            })

            it('R04 含密碼之字串由數據之getter拋出 → insert之reject為遮罩後字串, error事件同', async function() {
                let c = cases.find((x) => x.id === 'R04')
                let ctx = mkCtx({ util: true })
                let { r, evs } = await viaBatch(c.make(ctx))
                assert.strictEqual(verify(c, r, ctx), null)
                assert.strictEqual(evs[0][2], 'failed ***')
            })

            it('R11 錯誤自帶path為儲存路徑: reject(數據之getter)為同一物件(不遮路徑, Q3), detail(change訂閱函數)遮之', async function() {
                let c = cases.find((x) => x.id === 'R11')
                let ctx = mkCtx({ util: true })
                let e = c.make(ctx)
                let { r } = await viaBatch(e)
                let { detail } = await viaListener(e)
                assert.strictEqual(verify(c, { p: e.path, e, r, c: detail }, ctx), null)
            })

            it('R12 單獨帳號出現於外來錯誤: reject(數據之getter)為同一物件(不遮), detail(change訂閱函數)遮之', async function() {
                let c = cases.find((x) => x.id === 'R12')
                let ctx = mkCtx({ util: true })
                let e = c.make(ctx)
                let { r } = await viaBatch(e)
                let { detail } = await viaListener(e)
                assert.strictEqual(verify(c, { e, r, c: detail }, ctx), null)
            })

            it('O01 logDetail:true且無funLog: console.log(固定標籤, 遮罩後之錯誤副本)一次, 不含detail類秘密', async function() {
                let c = cases.find((x) => x.id === 'O01')
                let ctx = mkCtx({ util: true })
                let { detail } = c.make(ctx)
                let w = mk(URL_C, 'users', { logDetail: true })
                w.on('change', () => {
                    throw detail
                })
                let rs = await capRaw(() => w.insert({ id: `O${seq++}`, name: 'n' }))
                assert.ok(rs.length === 1 && rs[0].m === 'log' && rs[0].args[0] === 'change handler threw' && rs[0].args[1] instanceof Error, JSON.stringify(rs.map((v) => [v.m, v.args[0]])))
                assert.strictEqual(verify({ expect: { noSecret: 'detail' } }, rs, ctx), null)
            })

            it('A07 opt.funLog為genDiagFunLog所產生者: 只寫{ event, label, safe }, 細節不產生(不含秘密)', async function() {
                let ctx = mkCtx({ util: true })
                let rs = []
                let { funLog } = genDiagFunLog((o) => rs.push(o))
                let w = mk(URL_C, 'users', { funLog })
                w.on('change', () => {
                    throw new Error(`auth ${SEC.password} for ${SEC.username}`)
                })
                await w.insert({ id: `A${seq++}`, name: 'n' })
                assert.deepStrictEqual(rs, [{ event: 'orm-diag', label: 'change handler threw', safe: { mode: 'insert', errType: 'Error' } }])
                assert.strictEqual(verify({ expect: { noSecret: 'detail' } }, rs, ctx), null)
            })

        })


        describe('Jet引擎之錯誤文字含憑證: 整批reject、error事件、逐筆err(外來值經diag.err/diag.mask)', function() {

            //batch, 整批reject之站點: 資料表不存在(表名含密碼字樣)
            let batch = [
                ['select', (w) => w.select()],
                ['select(find)', (w) => w.select({ name: 'x' })],
                ['selectByPk', (w) => w.selectByPk('a')],
                ['insert', (w) => w.insert({ id: 'a', name: 'x' })],
                ['insertBulk', (w) => w.insertBulk([{ id: 'a', name: 'x' }])],
                ['delAll', (w) => w.delAll()],
                ['delAll(find)', (w) => w.delAll({ name: 'x' })],
            ]

            it('控制組(密碼不同): Jet之錯誤文字確實回顯表名, 七種整批reject皆含表名原文(證明下列遮罩案之輸入含憑證)', async function() {
                let w = mk(URL_Y, CL_X)
                for (let [lb, f] of batch) {
                    let r = await settle(f(w))
                    assert.ok(r.err !== undefined, `${lb}應reject`)
                    assert.ok(msgOf(r.err).indexOf(CL_X) >= 0, `${lb}: Jet之錯誤文字未回顯表名: ${msgOf(r.err)}`)
                }
            })

            for (let [lb, f] of batch) {
                it(`${lb}: reject不含憑證(含***), error事件之訊息與reject同源`, async function() {
                    let w = mk(URL_X, CL_X)
                    let evs = withEvents(w)
                    let r = await settle(f(w))
                    assert.ok(r.err !== undefined, '應reject')
                    let m = msgOf(r.err)
                    noPw(m, 'reject')
                    assert.ok(m.indexOf('t***q') >= 0, `表名之密碼字樣應遮為***: ${m}`)
                    if (r.err instanceof Error) {
                        noPw(r.err.stack, 'stack')
                    }
                    assert.strictEqual(evs.length, 1)
                    assert.strictEqual(evs[0][2], m, 'error事件之訊息與reject同源')
                })
            }

            it('save之寫入失敗(逐筆err): model另宣告資料表沒有之欄(欄名含密碼字樣), Jet之寫入錯誤文字回顯欄名 → 逐筆err遮罩, 逐筆事件同源', async function() {
                let fdM2 = `${fdTmp}/models-x`
                fs.mkdirSync(fdM2, { recursive: true })
                let src = fs.readFileSync('./models/users.js', 'utf8').replace('\'value\': {', `'c${PW}': {\ntype: DataTypes.FLOAT,\nallowNull: true,\nautoIncrement: false,\ncomment: null\n},\n'value': {`)
                fs.writeFileSync(`${fdM2}/users.js`, src, 'utf8')
                let w = mk(URL_X, 'users', { fdModels: fdM2 })
                let evs = withEvents(w)
                let r = await w.save([{ id: `W${seq++}`, name: 'x', [`c${PW}`]: 1 }])
                assert.strictEqual(r.length, 1)
                assert.strictEqual(r[0].ok, 0, JSON.stringify(r))
                noPw(r[0].err, 'save之寫入逐筆err')
                assert.ok(r[0].err.indexOf('c***') >= 0, r[0].err)
                assert.deepStrictEqual(evs.map((e) => [e[0], e[2]]), [['save', r[0].err]])
            })

            it('連線開啟失敗(資料庫檔不存在, 檔名含密碼字樣; Jet之訊息回顯路徑): del、save之整批reject(openFailed)與error事件遮罩', async function() {
                let fpNo = `${fdTmp}/no-${PW}.mdb`
                let w = mk(URL_X, 'users', { storage: fpNo })
                let evs = withEvents(w)
                for (let fn of ['del', 'save']) {
                    let r = await settle(w[fn]([{ id: 'a', name: 'x' }]))
                    assert.ok(r.err instanceof Error, `${fn}應reject Error: ${String(r.ok && JSON.stringify(r.ok))}`)
                    noPw(r.err.message, fn)
                    assert.ok(r.err.message.indexOf('no-***') >= 0, r.err.message)
                }
                assert.deepStrictEqual(evs.map((e) => e[0]), ['del', 'save'])
                for (let e of evs) {
                    noPw(e[2], 'error事件')
                }
                assert.ok(!fs.existsSync(fpNo))
            })

            it('insert、insertBulk之reject為Error副本(instanceof Error, 原型為Error.prototype), 訊息之憑證遮罩', async function() {
                let w = mk(URL_X, CL_X)
                for (let f of [() => w.insert({ id: 'a', name: 'x' }), () => w.insertBulk([{ id: 'a', name: 'x' }])]) {
                    let r = await settle(f())
                    assert.ok(r.err instanceof Error && Object.getPrototypeOf(r.err) === Error.prototype, String(r.err))
                    assert.ok(util.types.isNativeError(r.err))
                }
            })

            it('save: 逐筆err(預讀之Jet錯誤)於建立時遮罩, 逐筆之error事件與之同源; resolve之形狀不變', async function() {
                let w = mk(URL_X, CL_X)
                let evs = withEvents(w)
                let r = await w.save([{ id: 'a', name: 'x' }, { id: 'b', name: 'y' }])
                assert.strictEqual(r.length, 2)
                for (let v of r) {
                    assert.deepStrictEqual(Object.keys(v).sort(), ['err', 'n', 'nInserted', 'nModified', 'ok'])
                    assert.strictEqual(v.ok, 0)
                    noPw(v.err, 'save之逐筆err')
                    assert.ok(v.err.indexOf('t***q') >= 0, v.err)
                }
                assert.deepStrictEqual(evs.map((e) => [e[0], e[2]]), [['save', r[0].err], ['save', r[1].err]])
            })

            it('del: 逐筆err(刪除之Jet錯誤)於建立時遮罩, 逐筆之error事件與之同源', async function() {
                let w = mk(URL_X, CL_X)
                let evs = withEvents(w)
                let r = await w.del([{ id: 'a' }])
                assert.strictEqual(r.length, 1)
                assert.strictEqual(r[0].ok, 0)
                noPw(r[0].err, 'del之逐筆err')
                assert.ok(r[0].err.indexOf('t***q') >= 0, r[0].err)
                assert.deepStrictEqual(evs.map((e) => [e[0], e[2]]), [['del', r[0].err]])
            })

            it('單獨帳號不屬憑證(reject清單, dspec P1): 表名含帳號字樣者, 整批reject與逐筆err皆原文(不遮)', async function() {
                let w = mk(URL_Y, CL_U)
                let r1 = await settle(w.select())
                assert.ok(msgOf(r1.err).indexOf(CL_U) >= 0, msgOf(r1.err))
                let r2 = await settle(w.insert({ id: 'a', name: 'x' }))
                assert.ok(msgOf(r2.err).indexOf(CL_U) >= 0, msgOf(r2.err))
                let r3 = await w.save({ id: 'a', name: 'x' })
                assert.ok(r3[0].err.indexOf(CL_U) >= 0, r3[0].err)
                let r4 = await w.del({ id: 'a' })
                assert.ok(r4[0].err.indexOf(CL_U) >= 0, r4[0].err)
            })

        })


        describe('其他外來值之站點', function() {

            it('快照(snap): 呼叫端數據之自有getter拋出含憑證之錯誤 → insert、insertBulk、save、del之reject為遮罩後副本(不發error事件, 同修改前)', async function() {
                let w = mk(URL_X, 'users')
                let evs = withEvents(w)
                let mkRow = () => ({
                    id: 'sg',
                    get name() {
                        throw new Error(`snap ${URL_X} ${PW}`)
                    },
                })
                for (let fn of ['insert', 'insertBulk', 'save', 'del']) {
                    let r = await settle(w[fn](fn === 'insertBulk' ? [mkRow()] : mkRow()))
                    assert.ok(r.err instanceof Error, `${fn}應reject Error`)
                    noPw(r.err.message, fn)
                    assert.ok(r.err.message.indexOf('***') >= 0, r.err.message)
                }
                assert.deepStrictEqual(evs, [])
            })

            it('預檢(chkWf): 主鍵getter(延後之拋錯)拋出含憑證之錯誤 → insert、insertBulk、save、del之reject與error事件皆遮罩', async function() {
                let w = mk(URL_X, 'users')
                let evs = withEvents(w)
                for (let fn of ['insert', 'insertBulk', 'save', 'del']) {
                    let row = rowThrow('id', new Error(`pk getter ${PW}`))
                    let r = await settle(w[fn](fn === 'insertBulk' ? [row] : row))
                    assert.ok(r.err instanceof Error, `${fn}應reject Error: ${String(r.err)}`)
                    assert.strictEqual(r.err.message, 'pk getter ***', fn)
                }
                assert.deepStrictEqual(evs.map((e) => [e[0], e[2]]), [['insert', 'pk getter ***'], ['insertBulk', 'pk getter ***'], ['save', 'pk getter ***'], ['del', 'pk getter ***']])
            })

            it('整批流程: 欄位getter(延後之拋錯)拋出含憑證之錯誤 → insert、insertBulk、save之reject與error事件皆遮罩(連線字串整串為***), 資料庫不變', async function() {
                let ids = []
                for (let fn of ['insert', 'insertBulk', 'save']) {
                    let { r, evs, id } = await viaBatch(new Error(`col getter ${URL_X} ${PW}`), URL_X, fn)
                    ids.push(id)
                    assert.ok(r instanceof Error, fn)
                    assert.strictEqual(r.message, 'col getter *** ***', fn)
                    assert.strictEqual(evs[0][0], fn)
                    assert.strictEqual(evs[0][2], 'col getter *** ***')
                }
                let rs = await mk(URL_X, 'users').select({ id: { $in: ids } })
                assert.deepStrictEqual(rs, [])
            })

            it('sequelize之錯誤(記憶體過濾表): 拋出含憑證之錯誤 → select(find)之reject為遮罩後副本', async function() {
                let orig = Sequelize.Model.bulkCreate
                Sequelize.Model.bulkCreate = async function() {
                    throw new Error(`bulkCreate failed ${URL_X} ${USER}:${PW}`)
                }
                let r
                try {
                    r = await settle(mk(URL_X, 'users').select({ name: 'x' }))
                }
                finally {
                    Sequelize.Model.bulkCreate = orig
                }
                assert.ok(r.err instanceof Error)
                assert.strictEqual(r.err.message, 'bulkCreate failed *** ***')
            })

            it('sequelize之關閉失敗(initAdodb之close): 拋出含憑證之錯誤 → selectByPk之reject為遮罩後副本', async function() {
                let orig = Sequelize.prototype.close
                Sequelize.prototype.close = async function() {
                    await orig.call(this)
                    throw new Error(`close failed ${PW}`)
                }
                let r
                try {
                    r = await settle(mk(URL_X, 'users').selectByPk('nope'))
                }
                finally {
                    Sequelize.prototype.close = orig
                }
                assert.ok(r.err instanceof Error, String(r.err))
                assert.strictEqual(r.err.message, 'close failed ***')
            })

            it('initSequelize之外來失敗(匯入失敗後關閉拋錯): si.err為遮罩後字串, select之reject與init回傳之err皆同', async function() {
                let orig = Sequelize.prototype.close
                Sequelize.prototype.close = async function() {
                    await orig.call(this)
                    throw new Error(`close failed ${URL_X}`)
                }
                let r
                let si
                try {
                    let w = mk(URL_X, 'nomodel')
                    r = await settle(w.select())
                    si = await w.init()
                }
                finally {
                    Sequelize.prototype.close = orig
                }
                assert.strictEqual(r.err, 'close failed ***')
                assert.strictEqual(si.err, 'close failed ***')
            })

            it('執行檔之取得失敗(ensureBins離線缺檔, 訊息含快取路徑): 快取路徑含憑證字樣 → select與createStorage之reject遮罩, error事件同源', async function() {
                let old = process.env.W_BIN_CACHE
                process.env.W_BIN_CACHE = path.resolve(fdTmp, `cache-${PW}`)
                let r1
                let r2
                let evs
                try {
                    let w = mk(URL_X, 'users', { storage: `${fdTmp}/new-bin.mdb` })
                    evs = withEvents(w)
                    r1 = await settle(w.select())
                    r2 = await settle(w.createStorage())
                }
                finally {
                    if (old === undefined) {
                        delete process.env.W_BIN_CACHE
                    }
                    else {
                        process.env.W_BIN_CACHE = old
                    }
                }
                for (let r of [r1, r2]) {
                    assert.ok(r.err instanceof Error, String(r.err))
                    assert.strictEqual(r.err.code, 'E_OFFLINE_MISSING')
                    noPw(r.err.message, 'ensureBins')
                    assert.ok(r.err.message.indexOf('cache-***') >= 0, r.err.message.slice(0, 300))
                }
                assert.deepStrictEqual(evs.map((e) => [e[0], e[2]]), [['select', r1.err.message], ['createStorage', r2.err.message]])
            })

        })


        describe('本套件之固定詞彙原樣(語料R07; 密碼恰為其子字串)', function() {

            it('密碼為invalid: 條件(cvOrmFind、cvFind、主鍵否定條件)、預檢(主鍵良構)、procPk、逐筆err之固定詞彙原樣; 同實例之外來錯誤含invalid仍遮', async function() {
                let w = mk('mdb://u1:invalid', 'users', { autoGenPk: false })
                let evs = withEvents(w)
                let rs = []
                rs.push(await settle(w.select({ $foo: 1 })))
                rs.push(await settle(w.select({ nocol: 1 })))
                rs.push(await settle(w.select({ id: { $ne: '' } })))
                rs.push(await settle(w.delAll({ $foo: 1 })))
                rs.push(await settle(w.insert({ id: 'a\uD800', name: 'x' })))
                rs.push(await settle(w.insertBulk([{ id: 'a', name: 'x\uD800' }])))
                rs.push(await settle(w.insert({ name: 'x' })))
                let ms = rs.map((r) => msgOf(r.err))
                assert.deepStrictEqual(ms.slice(0, 1), ['invalid find: unsupported operator [$foo] at [find.$foo]'])
                assert.ok(/^invalid find: /.test(ms[1]) && ms[1].indexOf('***') < 0, ms[1])
                assert.strictEqual(ms[2], 'invalid find: invalid primary key value in negative condition at [find.id.$ne]')
                assert.strictEqual(ms[3], 'invalid find: unsupported operator [$foo] at [find.$foo]')
                assert.strictEqual(ms[4], 'invalid id: string contains lone surrogate at [data[0].id]')
                assert.strictEqual(ms[5], 'invalid data: string contains lone surrogate at [data[0].name]')
                assert.strictEqual(ms[6], 'invalid data[0].id, autoGenPk is false')
                assert.deepStrictEqual(evs.map((e) => e[2]), ms, 'error事件之訊息原樣')
                let r7 = await w.save({ id: 'a\uD800', name: 'x' })
                assert.strictEqual(r7[0].err, 'invalid id: string contains lone surrogate at [data[0].id]')
                let r8 = await w.del([{ id: '' }, { id: 'a\uD800' }])
                assert.deepStrictEqual(r8.map((v) => v.err), ['invalid data[0].id', 'invalid id: string contains lone surrogate at [data[1].id]'])
                //對照: 同實例之外來錯誤含invalid者遮罩
                let { r } = await viaBatch(new Error('backend invalid state'), 'mdb://u1:invalid')
                assert.strictEqual(r.message, 'backend *** state')
            })

            it('密碼為invalid: Jet之錯誤文字(表名含invalid)遮罩, 本套件之訊息不切碎(對照同上)', async function() {
                let w = mk('mdb://u1:invalid', 'tinvalidq')
                let r = await settle(w.select())
                assert.ok(msgOf(r.err).indexOf('t***q') >= 0 && msgOf(r.err).indexOf('tinvalidq') < 0, msgOf(r.err))
            })

            it('密碼為import: 匯入model失敗之固定詞彙(si.err)原樣, select之reject與init回傳之err皆同; 外來錯誤含import仍遮', async function() {
                let w = mk('mdb://u1:import', 'nomodel')
                let evs = withEvents(w)
                let fixed = 'can not import model: nomodel, need to use genModelsByDB, genModelsByTabs or create nomodel.js'
                let r = await settle(w.select())
                assert.strictEqual(r.err, fixed)
                assert.deepStrictEqual(evs.map((e) => e[2]), [fixed])
                let si = await w.init()
                assert.strictEqual(si.err, fixed)
                let { r: r2 } = await viaBatch(new Error('cannot import x'), 'mdb://u1:import')
                assert.strictEqual(r2.message, 'cannot *** x')
            })

        })


        describe('宣告(paths、patterns、mdb無主機連線字串)', function() {

            it('paths: 資料庫檔案路徑於診斷細節遮罩(原形式與絕對路徑), 對外之reject不遮(dspec Q3)', async function() {
                let abs = path.resolve(fpStorage)
                let { detail } = await viaListener(new Error(`open ${abs} and ${fpStorage}`))
                assert.strictEqual(detail.message, 'open *** and ***')
                let { r } = await viaBatch(new Error(`open ${abs}`))
                assert.strictEqual(r.message, `open ${abs}`)
            })

            it('patterns(mdbUrl): 外來值內之mdb://連線字串(非本實例之憑證)之://後整段遮罩, 對外值與診斷細節皆然', async function() {
                let other = 'mdb://Zother7:Zcred77'
                let { r } = await viaBatch(new Error(`see ${other} here`))
                assert.strictEqual(r.message, 'see mdb://*** here')
                let { detail } = await viaListener(new Error(`see ${other} here`))
                assert.strictEqual(detail.message, 'see mdb://*** here')
            })

            it('已知限制LDG9(記錄行為): 密碼含未編碼之@時(mdb://Zu9:Zp@ss@w0rdQ9), 本套件只取第一個@之前為帳密(Jet只收到Zu9:Zp), wsemi以最後一個@之後為主機; 連線字串整串與mdb://之後整段仍遮, 最後一個@之後之片段單獨出現時不遮', async function() {
                let url = 'mdb://Zu9:Zp@ss@w0rdQ9'
                let { r } = await viaBatch(new Error(`url ${url} and Zp@ss@w0rdQ9 and w0rdQ9`), url)
                assert.strictEqual(r.message, 'url *** and ***@w0rdQ9 and w0rdQ9')
            })

            it('errType與errCode之宣告: 自訂錯誤類別名不列(未宣告types, 為Error), 未宣告之整數代碼(如Jet之3022)不列, 系統代碼照列', async function() {
                class MyDbErr extends Error {}
                let e1 = new MyDbErr('x')
                e1.code = 3022
                let { safe } = await viaListener(e1)
                assert.deepStrictEqual(safe, { mode: 'insert', errType: 'Error' })
                let e2 = new TypeError('y')
                e2.code = 'ENOENT'
                let { safe: s2 } = await viaListener(e2)
                assert.deepStrictEqual(s2, { mode: 'insert', errType: 'TypeError', errCode: 'ENOENT' })
            })

        })

    })

}
