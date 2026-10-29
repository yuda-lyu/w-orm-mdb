import fs from 'fs'
import path from 'path'
import util from 'util'
import assert from 'assert'
import { importSrc, getSrcDir } from './tools/srcDir.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'
import { scenario, scenarioWrongPw, normScenario, ID, PW } from './tools/diagScenario.mjs'


//spec: sgud/rule/rulebook.md 之 R-DIAG(主控dspec〈診斷輸出與遮罩〉、wsemi之R-DIAG-01): 診斷輸出之單一出口(wsemi之getDiag實例)於WOrmMdb實例(真Jet引擎)之接線
//  R-DIAG-01 預設只輸出固定標籤與safe摘要(不出現資料值、id、後端錯誤原文、連線憑證)
//  R-DIAG-02 logDetail為true輸出(標籤, 遮罩後之細節)(wsemi之getDiag, 無bare), 連線憑證與資料庫檔案路徑遮罩
//  R-DIAG-03 funLog(label, safe, detail)取代console, detail為遮罩後之細節拷貝; 型別錯誤之選項視同未給
//  R-DIAG-04 opt.logging為true時sequelize紀錄函數經單一出口(預設只輸出敘述種類, 無deprecation警告)
//  R-DIAG-05 genModelsByTabs傳本實例之diag予w-orm-reladb(須≥1.1.18之diag參數契約; 本套件不替換全域console.log)
//  R-DIAG-08 回傳契約不變: 不含憑證之情境下各操作之resolve/reject內容、事件payload與時機與修改前(git HEAD)相同, 固定預期值為test/tools/diagGolden.json
//  R-DIAG-09 站點掃描: src內無console、process.stdout/stderr、emitWarning呼叫(出口在wsemi), 傳給sequelize之logging只有函數或false
//註: 對外錯誤值(reject、error事件、逐筆err)之接線另見unit-diaglog-wire
//註: 後端(Jet)錯誤訊息隨系統語系而異, 比對時換成固定字串(見tools/diagScenario.mjs之normScenario)


const nm = 'diaglog'
const UP = 'Zuser9:Zpw7'
const URL_UP = 'mdb://Zuser9:Zpw7'
const VID = 'Zid-secret-88'
const VNAME = 'Zname-secret-77'


//capture, 擷取console各方法(原引數)與process之warning事件
async function capture(fn) {
    let lines = []
    let warnings = []
    let ks = ['log', 'info', 'warn', 'error', 'debug']
    let olds = ks.map((k) => console[k])
    let onWarn = (w) => warnings.push(String(w && w.message))
    ks.forEach((k) => {
        console[k] = (...args) => lines.push({ k, args })
    })
    process.on('warning', onWarn)
    let result
    try {
        result = await fn()
        await new Promise((resolve) => setTimeout(resolve, 30))
    }
    finally {
        ks.forEach((k, i) => {
            console[k] = olds[i]
        })
        process.off('warning', onWarn)
    }
    return { lines, warnings, result }
}


//flat, 輸出展開為單一字串(Error含message與stack), 供檢查某值是否出現於任一輸出
function flat(cp) {
    let s = cp.lines.map((l) => l.args.map((a) => (typeof a === 'string' ? a : util.inspect(a, { depth: 8, showHidden: true }))).join(' ')).join('\n')
    return s + '\n' + cp.warnings.join('\n')
}


//trapConsoleLog, 執行fn期間監看console.log之賦值(取代): 回傳fn期間所有被賦予的值(呼叫端不應有任何取代全域console.log之行為), 結束後原樣還原
function trapConsoleLog(fn) {
    let desc = Object.getOwnPropertyDescriptor(console, 'log')
    let cur = console.log
    let sets = []
    Object.defineProperty(console, 'log', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
            return cur
        },
        set(v) {
            sets.push(v)
            cur = v
        }
    })
    try {
        fn()
    }
    finally {
        Object.defineProperty(console, 'log', desc)
    }
    return sets
}


//golden, 修改前(git HEAD)之固定預期值
const golden = JSON.parse(fs.readFileSync('./test/tools/diagGolden.json', 'utf8'))
const same = (r, key) => assert.deepStrictEqual(JSON.parse(JSON.stringify(normScenario(r))), golden[key], `回傳契約與修改前不同: ${key}`)


//scenarioLeak, 以辨識度高之值走過會經診斷輸出之路徑: 訂閱函數拋錯(change與error事件)、select之非主鍵條件(記憶體過濾表之SQL)
async function scenarioLeak(w) {
    w.on('change', () => {
        throw new Error(`listener ${ID} ${PW}`)
    })
    w.on('error', () => {
        throw new Error(`listener ${ID} ${PW}`)
    })
    let out = []
    await w.delAll({})
    out.push(await w.insert({ id: VID, name: VNAME, value: 7 }))
    out.push(await w.select({ name: VNAME }))
    out.push(await w.insertBulk([{ id: VID, name: VNAME }]).catch((err) => String(err))) //重複主鍵: 整批reject並發error事件
    out.push(await w.save({ id: VID, name: `${VNAME}-x` }))
    out.push(await w.del({ id: VID }))
    return out
}


if (isWindows()) {

    describe('WOrmMdb 診斷輸出(R-DIAG)', function() {

        this.timeout(180000)

        let ss = null
        let wo = null
        let jetOpen = null

        const mk = (ext = {}) => wo(mkOpt(ss.fpStorage, ext))

        before(async function() {
            ss = setupStorage(nm)
            wo = (await importSrc('WOrmMdb.mjs')).default
            jetOpen = (await importSrc('jet.mjs')).default
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        describe('預設(R-DIAG-01)', function() {

            it('訂閱函數拋錯與記憶體過濾: 輸出只有標籤與摘要, 不含id、資料值、訂閱函數之錯誤原文', async function() {
                let w = mk()
                let cp = await capture(() => scenarioLeak(w))
                let s = flat(cp)
                for (let t of [ID, PW, VID, VNAME, 'listener']) {
                    assert.ok(s.indexOf(t) < 0, `預設輸出含[${t}]: ${s.slice(0, 400)}`)
                }
                let labels = cp.lines.map((l) => l.args[0])
                assert.ok(labels.includes('change handler threw'), JSON.stringify(labels))
                assert.ok(labels.includes('error handler threw'), JSON.stringify(labels))
                for (let l of cp.lines) {
                    assert.strictEqual(l.args.length, 2, '預設輸出為(標籤, 摘要)')
                    assert.strictEqual(typeof l.args[0], 'string')
                    assert.deepStrictEqual(Object.keys(l.args[1]).sort(), ['errType', 'mode'], '摘要只有操作別與錯誤類別')
                    assert.strictEqual(l.args[1].errType, 'Error')
                }
                assert.deepStrictEqual([...new Set(cp.lines.map((l) => l.k))], ['log'], 'level省略: 各站皆寫console.log(stdout)')
                let modes = cp.lines.filter((l) => l.args[0] === 'change handler threw').map((l) => l.args[1].mode)
                assert.deepStrictEqual(modes, ['delAll', 'insert', 'save', 'del'])
                let modesErr = cp.lines.filter((l) => l.args[0] === 'error handler threw').map((l) => l.args[1].mode)
                assert.deepStrictEqual(modesErr, ['insertBulk'])
            })

            it('logging為true: 記憶體過濾表之SQL只輸出敘述種類(無欄位值、條件值), 無deprecation警告', async function() {
                let w = mk({ logging: true })
                let cp = await capture(() => scenarioLeak(w))
                let s = flat(cp)
                for (let t of [ID, PW, VID, VNAME, 'listener', 'Executing', 'users', 'INSERT INTO']) {
                    assert.ok(s.indexOf(t) < 0, `預設輸出含[${t}]: ${s.slice(0, 400)}`)
                }
                let sqls = cp.lines.filter((l) => l.args[0] === 'sql')
                assert.ok(sqls.length >= 3, `應有CREATE、INSERT、SELECT等紀錄: ${sqls.length}`)
                for (let l of sqls) {
                    assert.deepStrictEqual(Object.keys(l.args[1]), ['stmt'])
                    assert.ok(['SELECT', 'CREATE', 'PRAGMA', 'INSERT', 'DROP'].includes(l.args[1].stmt), l.args[1].stmt)
                }
                assert.ok(sqls.some((l) => l.args[1].stmt === 'INSERT'))
                assert.deepStrictEqual(cp.warnings, [], 'logging為true不得再觸發sequelize之deprecation警告')
            })

            it('沒有訂閱函數、沒有logging: 完全無輸出(含失敗之操作)', async function() {
                let w = mk()
                let cp = await capture(async () => {
                    await w.delAll({})
                    await w.insert({ id: VID, name: VNAME })
                    await w.insertBulk([{ id: VID, name: VNAME }]).catch(() => null)
                    await w.select({ name: VNAME })
                    await w.select({ $foo: 1 }).catch(() => null)
                    await w.del({ id: VID })
                })
                assert.deepStrictEqual(cp.lines, [])
                assert.deepStrictEqual(cp.warnings, [])
            })

        })

        describe('logDetail(R-DIAG-02)', function() {

            it('輸出(標籤, 細節): 訂閱函數拋出之錯誤為(change handler threw|error handler threw, Error副本); sql全文為(sql, 字串)(wsemi之getDiag無bare)', async function() {
                let w = mk({ logging: true, logDetail: true })
                let cp = await capture(() => scenarioLeak(w))
                let errs = cp.lines.filter((l) => l.args.length === 2 && ['change handler threw', 'error handler threw'].includes(l.args[0]) && l.args[1] instanceof Error)
                assert.ok(errs.length >= 5, `訂閱函數拋錯之輸出: ${errs.length}`)
                for (let l of errs) {
                    assert.strictEqual(l.args[1].message, `listener ${ID} ${PW}`)
                }
                let sqls = cp.lines.filter((l) => l.args.length === 2 && l.args[0] === 'sql' && typeof l.args[1] === 'string')
                assert.ok(sqls.length >= 3)
                for (let l of sqls) {
                    assert.ok(l.args[1].startsWith('Executing (default): '), l.args[1])
                }
                assert.strictEqual(cp.lines.length, errs.length + sqls.length, '無其他形式之輸出')
                assert.deepStrictEqual([...new Set(cp.lines.map((l) => l.k))], ['log'], 'level省略: logDetail之細節亦寫console.log(stdout)')
                let all = sqls.map((l) => l.args[1]).join('\n')
                assert.ok(all.indexOf(`'${VNAME}'`) >= 0, 'sql全文應含條件值')
                assert.ok(/INSERT INTO `users`/.test(all) && all.indexOf(`'${VID}'`) >= 0, 'select之過濾表以INSERT寫入各列欄位值(含id), sql全文應含之')
                assert.deepStrictEqual(cp.warnings, [])
            })

            it('logDetail之型別錯誤(非true)視同未給: 預設之安全輸出', async function() {
                for (let v of ['true', 1, {}, [], null, undefined, 'yes']) {
                    let w = mk({ logDetail: v })
                    let cp = await capture(async () => {
                        w.on('change', () => {
                            throw new Error(`listener ${ID}`)
                        })
                        await w.insert({ id: VID, name: VNAME })
                        await w.del({ id: VID })
                    })
                    assert.ok(flat(cp).indexOf(ID) < 0, `logDetail=${String(v)}時輸出含id`)
                    assert.deepStrictEqual(cp.lines.map((l) => l.args[0]), ['change handler threw', 'change handler threw'])
                }
            })

        })

        describe('funLog(R-DIAG-03)', function() {

            it('收(label, safe, detail): safe為不含個資之摘要, detail為完整細節; 不寫console', async function() {
                let got = []
                let w = mk({ logging: true, funLog: (...a) => got.push(a) })
                let cp = await capture(() => scenarioLeak(w))
                assert.deepStrictEqual(cp.lines, [], 'funLog取代console')
                assert.deepStrictEqual(cp.warnings, [])
                let ch = got.filter((a) => a[0] === 'change handler threw')
                assert.deepStrictEqual(ch.map((a) => a[1].mode), ['delAll', 'insert', 'save', 'del'])
                for (let a of ch) {
                    assert.strictEqual(a.length, 3)
                    assert.deepStrictEqual(Object.keys(a[1]).sort(), ['errType', 'mode'])
                    assert.ok(a[2] instanceof Error && a[2].message === `listener ${ID} ${PW}`, '細節含訂閱函數之完整錯誤')
                }
                let er = got.filter((a) => a[0] === 'error handler threw')
                assert.deepStrictEqual(er.map((a) => a[1].mode), ['insertBulk'])
                let sql = got.filter((a) => a[0] === 'sql')
                assert.ok(sql.length >= 3)
                for (let a of sql) {
                    assert.strictEqual(a.length, 3)
                    assert.deepStrictEqual(Object.keys(a[1]), ['stmt'])
                    assert.ok(typeof a[2] === 'string' && a[2].startsWith('Executing (default): '))
                }
                assert.ok(sql.some((a) => a[2].indexOf(`'${VNAME}'`) >= 0), '細節含sql全文與條件值')
                let safeAll = JSON.stringify(got.map((a) => [a[0], a[1]]))
                for (let t of [ID, PW, VID, VNAME]) {
                    assert.ok(safeAll.indexOf(t) < 0, `摘要含[${t}]`)
                }
            })

            it('funLog存在時logDetail不另寫console', async function() {
                let got = []
                let w = mk({ logDetail: true, funLog: (...a) => got.push(a) })
                let cp = await capture(() => scenarioLeak(w))
                assert.deepStrictEqual(cp.lines, [])
                assert.ok(got.length >= 5)
            })

            it('funLog之型別錯誤(非函數)視同未給: 走console之預設輸出', async function() {
                for (let v of ['x', 1, {}, [], true, null]) {
                    let w = mk({ funLog: v })
                    let cp = await capture(async () => {
                        w.on('change', () => {
                            throw new Error(`listener ${ID}`)
                        })
                        await w.insert({ id: VID, name: VNAME })
                        await w.del({ id: VID })
                    })
                    assert.deepStrictEqual(cp.lines.map((l) => l.args[0]), ['change handler threw', 'change handler threw'], `funLog=${String(v)}`)
                }
            })

            it('訂閱函數拋出之錯誤其message為存取器: funLog與logDetail之細節拷貝不執行該存取器(使用端程式), 仍收到Error副本', async function() {
                let ran = 0
                let e = new Error('x')
                Object.defineProperty(e, 'message', {
                    get() {
                        ran++
                        return `m ${ID}`
                    },
                    configurable: true
                })
                let got = []
                let w = mk({ funLog: (...a) => got.push(a) })
                w.on('change', () => {
                    throw e
                })
                await w.insert({ id: VID, name: VNAME })
                await w.del({ id: VID })
                assert.strictEqual(ran, 0)
                assert.strictEqual(got.length, 2)
                assert.ok(got[0][2] instanceof Error)
                let w2 = mk({ logDetail: true })
                w2.on('change', () => {
                    throw e
                })
                let cp = await capture(async () => {
                    await w2.insert({ id: VID, name: VNAME })
                    await w2.del({ id: VID })
                })
                assert.strictEqual(ran, 0)
                assert.strictEqual(cp.lines.length, 2)
            })

            it('funLog拋錯、回傳reject之promise皆被吞下: 操作結果與修改前相同, 不成為unhandledRejection', async function() {
                let bad = []
                let onRej = (e) => bad.push(e)
                process.on('unhandledRejection', onRej)
                try {
                    for (let funLog of [() => {
                        throw new Error('x')
                    }, () => Promise.reject(new Error('rej')), () => ({ then: (a, b) => Promise.reject(new Error('rej2')) })]) {
                        let w = mk({ funLog })
                        let r = await scenario(w, true)
                        same(r, 'plainBad')
                    }
                    await new Promise((resolve) => setTimeout(resolve, 50))
                }
                finally {
                    process.off('unhandledRejection', onRej)
                }
                assert.deepStrictEqual(bad.map((v) => v.message), [])
            })

            it('選項之getter拋錯: 與本套件其他選項(如logging)相同, 建構時原樣拋出(opt於建構開始時讀一次, 見R-WF), 不被吞下', function() {
                for (let k of ['logDetail', 'funLog', 'logging', 'useStable']) {
                    let o = mkOpt(ss.fpStorage)
                    Object.defineProperty(o, k, {
                        get() {
                            throw new Error(`getter boom ${k}`)
                        },
                        enumerable: true
                    })
                    assert.throws(() => wo(o), (err) => err.message === `getter boom ${k}`, k)
                }
            })

            it('不可列舉或繼承而來之選項(defineProperty、類別getter)亦生效, 與其他選項相同(opt依選項名稱讀取, 不以列舉為限)', async function() {
                let listener = () => {
                    throw new Error(`listener ${ID}`)
                }

                //funLog, 不可列舉之自有屬性
                let got = []
                let o = mkOpt(ss.fpStorage)
                Object.defineProperty(o, 'funLog', { value: (...a) => got.push(a), enumerable: false })
                let w1 = wo(o)
                w1.on('change', listener)
                let cp1 = await capture(async () => {
                    await w1.insert({ id: VID, name: VNAME })
                    await w1.del({ id: VID })
                })
                assert.deepStrictEqual(cp1.lines, [])
                assert.strictEqual(got.length, 2)

                //logDetail, 類別之getter(原型上, 不可列舉)
                class Opt {
                    constructor(x) {
                        Object.assign(this, x)
                    }

                    get logDetail() {
                        return true
                    }
                }
                let w2 = wo(new Opt(mkOpt(ss.fpStorage)))
                w2.on('change', listener)
                let cp2 = await capture(async () => {
                    await w2.insert({ id: VID, name: VNAME })
                    await w2.del({ id: VID })
                })
                let errs = cp2.lines.filter((l) => l.args.length === 2 && l.args[0] === 'change handler threw' && l.args[1] instanceof Error)
                assert.strictEqual(errs.length, 2)
            })

            it('選項於建構時讀一次: 其後改動原opt(logDetail、funLog)不影響已建構之實例', async function() {
                let got = []
                let o = mkOpt(ss.fpStorage, { funLog: (...a) => got.push(a) })
                let w = wo(o)
                o.funLog = null
                o.logDetail = true
                let cp = await capture(async () => {
                    w.on('change', () => {
                        throw new Error(`listener ${ID}`)
                    })
                    await w.insert({ id: VID, name: VNAME })
                    await w.del({ id: VID })
                })
                assert.deepStrictEqual(cp.lines, [])
                assert.strictEqual(got.length, 2)
            })

        })

        describe('回傳契約不變(R-DIAG-08)', function() {

            const cfgs = [
                ['預設', {}],
                ['logDetail', { logDetail: true }],
                ['funLog', { funLog: () => {} }],
                ['logging', { logging: true }],
                ['logging+logDetail', { logging: true, logDetail: true }],
                ['logging+funLog', { logging: true, funLog: () => {} }],
            ]

            for (let [lb, ext] of cfgs) {
                it(`${lb}: 無訂閱函數拋錯之情境(七函數、事件payload、整批reject)與修改前相同`, async function() {
                    let w = mk(ext)
                    let cp = await capture(() => scenario(w, false))
                    same(cp.result, 'plain')
                })
            }

            for (let [lb, ext] of cfgs) {
                it(`${lb}: 訂閱函數拋錯之情境: 操作結果、事件payload與修改前相同(訂閱函數拋錯不影響操作)`, async function() {
                    let w = mk(ext)
                    let cp = await capture(() => scenario(w, true))
                    same(cp.result, 'plainBad')
                })
            }

            it('加密檔(正確密碼): 與修改前相同', async function() {
                let s2 = setupStorage(`${nm}-enc`, { useEncryption: true })
                try {
                    let w = wo(mkOpt(s2.fpStorage, { url: 'mdb://username:password', useEncryption: true, logDetail: true }))
                    let cp = await capture(() => scenario(w, false))
                    same(cp.result, 'enc')
                }
                finally {
                    cleanStorage(s2.fdTmp)
                }
            })

            it('加密檔(錯誤密碼): 各函數reject/ok:0之形態與事件payload與修改前相同, 且不產生診斷輸出(後端錯誤原文不經console)', async function() {
                let s2 = setupStorage(`${nm}-encw`, { useEncryption: true })
                try {
                    let w = wo(mkOpt(s2.fpStorage, { url: 'mdb://username:wrongpw', useEncryption: true }))
                    let cp = await capture(() => scenarioWrongPw(w))
                    same(cp.result, 'encWrong')
                    assert.deepStrictEqual(cp.lines, [])
                }
                finally {
                    cleanStorage(s2.fdTmp)
                }
            })

        })

        describe('連線憑證遮罩(R-DIAG-02, 加密檔: 帳號Zuser9、密碼Zpw7)', function() {

            let s3 = null
            let mkEnc = null

            before(async function() {
                s3 = { fdTmp: `./test/temp-${nm}-cred` }
                fs.rmSync(s3.fdTmp, { recursive: true, force: true })
                fs.mkdirSync(s3.fdTmp, { recursive: true })
                let fp = `${s3.fdTmp}/cred.mdb`
                mkEnc = (ext = {}) => wo(mkOpt(fp, { url: URL_UP, useEncryption: true, ...ext }))

                //以帳號密碼Zuser9:Zpw7建立加密檔與users表
                assert.strictEqual(await mkEnc().createStorage(), 'created')
                let jet = jetOpen({ path: path.resolve(fp), password: UP })
                await jet.execute('CREATE TABLE [users] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255), [value] DOUBLE)')
            })

            after(function() {
                cleanStorage(s3.fdTmp)
            })

            //把憑證放進訂閱函數拋出之錯誤訊息與sql之條件值: 輸出中任何位置皆不得出現
            const TOKENS = ['Zuser9', 'Zpw7', UP, URL_UP]
            const run = (w) => scenarioCred(w)
            async function scenarioCred(w) {
                w.on('change', () => {
                    throw new Error(`boom ${URL_UP} ${UP} ${'Zpw7'} ${ID}`)
                })
                await w.insert({ id: VID, name: 'Zpw7' })
                await w.select({ name: 'Zpw7' }) //sql之條件值即密碼
                await w.del({ id: VID })
            }

            it('預設: 無任何憑證出現', async function() {
                let cp = await capture(() => run(mkEnc({ logging: true })))
                let s = flat(cp)
                for (let t of [...TOKENS, ID]) {
                    assert.ok(s.indexOf(t) < 0, `預設輸出含[${t}]`)
                }
                assert.ok(cp.lines.length >= 5)
            })

            it('logDetail: 還原細節但憑證以***遮罩(訂閱函數之錯誤訊息與stack、sql之條件值), 其餘細節保留', async function() {
                let cp = await capture(() => run(mkEnc({ logging: true, logDetail: true })))
                let s = flat(cp)
                for (let t of TOKENS) {
                    assert.ok(s.indexOf(t) < 0, `logDetail輸出含憑證[${t}]: ${s.slice(0, 500)}`)
                }
                assert.ok(s.indexOf('***') >= 0)
                assert.ok(s.indexOf(ID) >= 0, '非憑證之細節應保留')
                let errs = cp.lines.filter((l) => l.args.length === 2 && l.args[0] === 'change handler threw' && l.args[1] instanceof Error)
                assert.ok(errs.length >= 2)
                assert.strictEqual(errs[0].args[1].message, `boom *** *** *** ${ID}`)
                let sqls = cp.lines.filter((l) => l.args.length === 2 && l.args[0] === 'sql' && typeof l.args[1] === 'string')
                assert.ok(sqls.some((l) => l.args[1].indexOf(`'***'`) >= 0), 'sql之條件值(密碼)應遮罩')
            })

            it('funLog: detail(完整細節)之憑證遮罩, safe不含憑證', async function() {
                let got = []
                await run(mkEnc({ logging: true, funLog: (...a) => got.push(a) }))
                let s = util.inspect(got, { depth: 10, showHidden: true })
                for (let t of TOKENS) {
                    assert.ok(s.indexOf(t) < 0, `funLog收到憑證[${t}]`)
                }
                let ch = got.filter((a) => a[0] === 'change handler threw')
                assert.ok(ch.length >= 2)
                assert.strictEqual(ch[0][2].message, `boom *** *** *** ${ID}`)
                assert.ok(ch[0][2] instanceof Error)
                assert.deepStrictEqual(ch[0][1], { mode: 'insert', errType: 'Error' })
            })

            it('送給funLog之細節為拷貝: 遮罩不改動使用端之原錯誤物件', async function() {
                let got = []
                let w = mkEnc({ funLog: (...a) => got.push(a) })
                let orig = new Error(`boom ${UP}`)
                w.on('change', () => {
                    throw orig
                })
                await w.insert({ id: VID, name: 'n' })
                await w.del({ id: VID })
                assert.strictEqual(orig.message, `boom ${UP}`)
                assert.strictEqual(got[0][2].message, 'boom ***')
                assert.notStrictEqual(got[0][2], orig)
            })

        })

        describe('genModelsByTabs之輸出經單一出口(R-DIAG-05; w-orm-reladb≥1.1.18以其diag參數契約收本實例之wsemi getDiag實例, 預設只輸出標籤與{name,type}, logDetail與funLog由diag承接)', function() {

            let fdOut = null

            before(function() {
                fdOut = `./test/temp-${nm}-models`
                fs.rmSync(fdOut, { recursive: true, force: true })
            })

            after(function() {
                fs.rmSync(fdOut, { recursive: true, force: true })
            })

            //tabs, 一個可產生之資料表; badTabs之表名含Windows檔名不允許之字元, 使存檔失敗而走[存檔失敗]之輸出
            const tabs = (n) => ({ [n]: { id: { type: 'STRING', pk: true }, name: 'STRING' } })
            const badTabs = { 'bad|name': { id: { type: 'STRING', pk: true } } }

            it('產生model檔之結果不變(檔案內容與是否產生)', async function() {
                let w = mk()
                let cp = await capture(async () => {
                    w.genModelsByTabs(fdOut, { tgen: { id: { type: 'STRING', pk: true }, name: 'STRING' } }, { type: 'js' })
                })
                let fp = `${fdOut}/tgen.js`
                assert.ok(fs.existsSync(fp))
                let c = fs.readFileSync(fp, 'utf8')
                assert.ok(c.indexOf('sequelize.define(\'tgen\'') >= 0 && c.indexOf('primaryKey') >= 0)
                assert.ok(cp.warnings.length === 0)
            })

            it('預設: 輸出只有標籤與{name,type}(存檔失敗另有errType與機器代碼errCode), 不含檔案路徑與存檔失敗之錯誤原文(含路徑)', async function() {
                let w = mk()
                let cp = await capture(async () => {
                    w.genModelsByTabs(fdOut, tabs('tgen2'), { type: 'js' })
                    w.genModelsByTabs(fdOut, badTabs, { type: 'js' })
                })
                assert.ok(fs.existsSync(`${fdOut}/tgen2.js`), '正常之表仍產生model檔')
                let s = flat(cp)
                for (let t of ['tgen2.js', '.js', 'temp-diaglog-models', 'bad|name.js', 'no such file', 'open']) {
                    assert.ok(s.indexOf(t) < 0, `預設輸出含[${t}]: ${s}`)
                }
                let labels = cp.lines.map((l) => String(l.args[0]))
                assert.ok(labels.includes('generate file:'), JSON.stringify(labels))
                assert.ok(labels.includes('save file catch'), JSON.stringify(labels))
                for (let l of cp.lines) {
                    assert.strictEqual(l.args.length, 2, '預設輸出為(標籤, 摘要)')
                    assert.strictEqual(l.k, 'log', 'genModelsByTabs之輸出寫console.log(stdout)')
                }
                assert.deepStrictEqual(cp.lines[0].args[1], { name: 'tgen2', type: 'js' })
                let sc = cp.lines[1].args[1]
                assert.deepStrictEqual({ name: sc.name, type: sc.type, errType: sc.errType }, { name: 'bad|name', type: 'js', errType: 'Error' })
                assert.ok(sc.errCode === undefined || /^E[A-Z]+$/.test(sc.errCode), `errCode應為機器代碼: ${sc.errCode}`)
            })

            it('logDetail輸出(標籤, 細節): 產生之檔案路徑、存檔失敗之錯誤副本(其自帶之path於細節遮罩, wsemi之動態秘密); funLog收(label, safe, detail)且不寫console', async function() {
                let w1 = mk({ logDetail: true })
                let cp = await capture(async () => {
                    w1.genModelsByTabs(fdOut, tabs('tgen3'), { type: 'js' })
                    w1.genModelsByTabs(fdOut, badTabs, { type: 'js' })
                })
                let gen = cp.lines.filter((l) => l.args[0] === 'generate file:')
                assert.ok(gen.length === 1 && gen[0].args.length === 2 && String(gen[0].args[1]).indexOf('tgen3.js') >= 0, flat(cp))
                let sc = cp.lines.filter((l) => l.args[0] === 'save file catch')
                assert.ok(sc.length === 1 && sc[0].args.length === 2 && sc[0].args[1] instanceof Error, flat(cp))
                assert.ok(sc[0].args[1].message.indexOf('***') >= 0 && sc[0].args[1].message.indexOf('bad|name') < 0, `存檔失敗之錯誤路徑應於細節遮罩: ${sc[0].args[1].message}`)

                let got = []
                let w2 = mk({ funLog: (...a) => got.push(a) })
                let cp2 = await capture(async () => {
                    w2.genModelsByTabs(fdOut, tabs('tgen4'), { type: 'js' })
                    w2.genModelsByTabs(fdOut, badTabs, { type: 'js' })
                })
                assert.deepStrictEqual(cp2.lines, [])
                assert.ok(got.some((a) => a[0] === 'generate file:' && a.length === 3 && String(a[2]).indexOf('tgen4.js') >= 0), util.inspect(got, { depth: 3 }))
                assert.ok(got.some((a) => a[0] === 'save file catch' && a.length === 3 && a[2] instanceof Error && a[1].name === 'bad|name'), util.inspect(got, { depth: 3 }))
            })

            it('funLog內呼叫console.log(常見之轉送寫法): 不遞迴, funLog每筆輸出只被呼叫一次', async function() {
                let n = 0
                let w = mk({
                    funLog: (label) => {
                        n++
                        console.log(`[F] ${label}`)
                    }
                })
                let cp = await capture(async () => {
                    w.genModelsByTabs(fdOut, tabs('tgen6'), { type: 'js' })
                })
                assert.strictEqual(n, 1)
                assert.deepStrictEqual(cp.lines.map((l) => l.args.join(' ')), ['[F] generate file:'])
            })

            it('不替換全域console.log: 呼叫期間無任何對console.log之賦值, 呼叫前後與funLog執行時所見皆為同一函數(預設、logDetail、funLog三管道)', async function() {
                let cp = await capture(async () => {
                    let seen = []
                    let ws = [mk(), mk({ logDetail: true }), mk({ funLog: () => seen.push(console.log) })]
                    ws.forEach((w, k) => {
                        let before = console.log
                        let sets = trapConsoleLog(() => {
                            w.genModelsByTabs(fdOut, tabs(`tgenA${k}`), { type: 'js' })
                            w.genModelsByTabs(fdOut, badTabs, { type: 'js' })
                        })
                        assert.deepStrictEqual(sets, [], `管道${k}: 呼叫期間console.log被賦值`)
                        assert.strictEqual(console.log, before, `管道${k}: 呼叫後console.log已不是同一函數`)
                    })
                    assert.ok(seen.length >= 2, 'funLog應收到輸出')
                    assert.ok(seen.every((f) => f === console.log), 'funLog執行時所見之console.log應為同一函數')
                })
                assert.ok(cp.lines.length >= 4, '預設與logDetail管道之輸出仍進console')
            })

            it('連線憑證遮罩: 路徑或錯誤文字含帳密者於logDetail與funLog之細節中亦遮罩', async function() {
                let fdCred = `${fdOut}/Zuser9-Zpw7`
                let wc = wo(mkOpt(ss.fpStorage, { url: URL_UP, useEncryption: true, logDetail: true }))
                let cp = await capture(async () => {
                    wc.genModelsByTabs(fdCred, tabs('tgen5'), { type: 'js' })
                })
                let s = flat(cp)
                assert.ok(s.indexOf('Zuser9') < 0 && s.indexOf('Zpw7') < 0, `logDetail輸出含憑證: ${s}`)
                assert.ok(fs.existsSync(`${fdCred}/tgen5.js`), '資料夾名含憑證字樣不影響產生')
            })

        })

        describe('站點掃描(R-DIAG-09)', function() {

            const fdSrc = () => getSrcDir()
            const code = (fn) => {
                //去除註解後之程式碼行(行首之//、JSDoc與區塊註解行, 及以空白起頭之行尾//註解)
                let r = []
                let inBlock = false
                for (let ln of fs.readFileSync(path.join(fdSrc(), fn), 'utf8').split(/\r?\n/)) {
                    let t = ln.trim()
                    if (inBlock) {
                        if (t.indexOf('*/') >= 0) {
                            inBlock = false
                        }
                        continue
                    }
                    if (t.startsWith('/*')) {
                        if (t.indexOf('*/') < 0) {
                            inBlock = true
                        }
                        continue
                    }
                    if (t.startsWith('//') || t.startsWith('*')) {
                        continue
                    }
                    r.push(ln.replace(/\s\/\/.*$/, ''))
                }
                return r
            }
            const fns = () => fs.readdirSync(fdSrc()).filter((v) => v.endsWith('.mjs'))

            it('src內無console、process.stdout、process.stderr、emitWarning之呼叫(診斷輸出之出口為wsemi之getDiag)', function() {
                let hits = []
                for (let fn of fns()) {
                    code(fn).forEach((ln, k) => {
                        if (/\bconsole\s*[.[]|process\s*\.\s*(stdout|stderr)|emitWarning|\bwarn\s*\(/.test(ln)) {
                            hits.push(`${fn}#${k}: ${ln.trim()}`)
                        }
                    })
                }
                assert.deepStrictEqual(hits, [])
            })

            it('單一實作(dspec D1): src無自寫之診斷出口與遮罩(無getDiag.mjs), WOrmMdb之getDiag、getDiagSecrets、maskDiagUrl皆取自wsemi', function() {
                assert.ok(!fns().includes('getDiag.mjs'), 'src/getDiag.mjs應已刪除')
                let c = code('WOrmMdb.mjs').join('\n')
                for (let [nm, mod] of [['getDiag', 'getDiag'], ['getDiagSecrets', 'getDiagSecrets'], ['maskDiagUrl', 'maskDiagUrl']]) {
                    assert.ok(new RegExp(`^import ${nm} from 'wsemi/src/${mod}\\.mjs'$`, 'm').test(c), `${nm}應取自wsemi`)
                }
            })

            it('src內任何檔皆不對console賦值或重新定義(不替換全域console.log; R-DIAG-05)', function() {
                let hits = []
                for (let fn of fns()) {
                    code(fn).forEach((ln, k) => {
                        if (/\bconsole\s*(\.\s*\w+|\[[^\]]*\])\s*=[^=>]/.test(ln) || /\b(defineProperty|defineProperties|assign|setPrototypeOf|set)\s*\(\s*console\b/.test(ln)) {
                            hits.push(`${fn}#${k}: ${ln.trim()}`)
                        }
                    })
                }
                assert.deepStrictEqual(hits, [])
            })

            it('src內之logging:賦值皆為受logSql管控之形式(不得直接傳opt.logging: true時sequelize以console.log輸出並觸發deprecation); 行為面見下一案', function() {
                let all = []
                for (let fn of fns()) {
                    code(fn).forEach((ln) => {
                        if (/\blogging\s*:/.test(ln)) {
                            all.push(`${fn}: ${ln.trim()}`)
                        }
                    })
                }
                assert.strictEqual(all.length, 2, JSON.stringify(all))
                for (let ln of all) {
                    assert.ok(ln.indexOf('logSql') >= 0 && ln.indexOf('opt.logging') >= 0 && ln.indexOf(': false') >= 0, ln)
                }
            })

            it('initSequelize(行為): sequelize之logging只在opt.logging為true且給予logSql時為該函數, 其餘一律false(絕不為true或console.log)', async function() {
                let { initSequelize } = await importSrc('queryMemory.mjs')
                let base = { cl: 'users', fdModels: './models', modelType: 'js', pk: 'id' }
                let fn = () => {}
                for (let [lg, f, exp] of [[true, fn, fn], [true, undefined, false], [false, fn, false], ['true', fn, false], [1, fn, false], [undefined, fn, false]]) {
                    let r = await initSequelize({ ...base, logging: lg }, f)
                    try {
                        assert.strictEqual(r.sequelize.options.logging, exp, `logging=${String(lg)}, logSql=${typeof f}`)
                    }
                    finally {
                        await r.sequelize.close()
                    }
                }
            })

        })

    })

}
