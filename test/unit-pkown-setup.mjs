import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { importSrc } from './tools/srcDir.mjs'
import { cleanStorage } from './unit-setup.mjs'


//共用層(第569項, R-PKOWN-01): 不含測試案例; 供 unit-pkown1~3 使用
//spec: sgud/rule/rulebook_pk.md 之 R-PKOWN-01(主鍵只認自有可列舉之資料屬性)
//  P1 列之主鍵欄(id或opt.pk)為繼承(原型鏈上, 不論值之型別)或自有不可列舉者視為未帶: autoGenPk為true補新主鍵(自有可列舉資料屬性), 為false照本庫既有之未帶處置(整批reject invalid data[k].id, autoGenPk is false);
//     主鍵欄為字串類而繼承值為有限數字者同樣視為未帶(本庫有限數字為有效主鍵, 但須為呼叫端自有可列舉者)
//  P2 判定不得多讀有效輸入: 先以既有路徑取值, 值為未帶即短路, 只有值為[給了]才查描述子(不呼叫getter)
//  P3 del: 繼承之主鍵視為未給主鍵(該筆ok為0附既有之invalid data[k].id), 不得刪除庫內同值之列; save: 不得以繼承值覆寫或更新同值之列; insert系: 不得因繼承值而跳過、撞鍵或寫入缺主鍵之列
//  P4 selectByPk收純量, 不適用(傳列物件回null)
//  P5 非主鍵欄之繼承可列舉欄位與類別getter: 既有處置不變
//註: 每個案例以原生SQL(經jet)清表與驗證, 驗證不倚賴受測之函數; 以importSrc取受測之src, 可以WORM_SRC_DIR指向修改前之src做[修前紅]


const NO_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const MSG_NOPK_OFF = 'invalid data[0].id, autoGenPk is false'
const MSG_DEL = 'invalid data[0].id'


class GetA {
    get id() {
        return 'a9'
    }
}
class GetN {
    get id() {
        return 123
    }
}
class RowPlain {}


//seeds, 各表之初始列; has者含與繼承值同值之列(顯出跳過、覆寫、刪除)
const seedsStr = {
    none: [{ id: 'z0', name: 'z' }],
    has: [{ id: 'a9', name: 'seed' }, { id: '123', name: 'seed123' }, { id: 'z0', name: 'z' }],
}
const seedsInt = {
    none: [{ id: 5, name: 'z' }],
    has: [{ id: 123, name: 'seed123' }, { id: 5, name: 'z' }],
}


//shapes, 字串主鍵表(users)之列形狀; kind為unset者主鍵欄不屬呼叫端自有可列舉(應視為未帶), own者為對照(自有可列舉, key為其主鍵值)
//pollute為真者於呼叫期間在Object.prototype定義不可列舉之id(值為pollute): 純物件之列與類別實例之列皆經原型鏈讀得之
const shapesStr = [
    { nm: '繼承字串', kind: 'unset', mk: () => Object.assign(Object.create({ id: 'a9' }), { name: 'n' }) },
    { nm: '繼承數字(字串欄之有效數字)', kind: 'unset', mk: () => Object.assign(Object.create({ id: 123 }), { name: 'n' }) },
    { nm: '類別getter(字串)', kind: 'unset', mk: () => Object.assign(new GetA(), { name: 'n' }) },
    { nm: 'frozen原型', kind: 'unset', mk: () => Object.assign(Object.create(Object.freeze({ id: 'a9' })), { name: 'n' }) },
    { nm: '自有不可列舉(原型無id)', kind: 'unset', mk: () => Object.defineProperty({ name: 'n' }, 'id', { value: 'a9', enumerable: false, writable: true, configurable: true }) },
    { nm: '自有不可列舉(原型有id)', kind: 'unset', mk: () => Object.defineProperty(Object.assign(Object.create({ id: 'a9' }), { name: 'n' }), 'id', { value: 'a9', enumerable: false, writable: true, configurable: true }) },
    { nm: 'Object.prototype被定義id(純物件之列)', kind: 'unset', mk: () => ({ name: 'n' }), pollute: 'a9' },
    { nm: '自有可列舉', kind: 'own', key: 'a9', mk: () => ({ id: 'a9', name: 'n' }) },
    { nm: '自有遮蔽繼承', kind: 'own', key: 'b1', mk: () => Object.assign(Object.create({ id: 'a9' }), { id: 'b1', name: 'n' }) },
]
//shapesMore, 其餘形狀(只加測insert、save、del三個入口於同值列之情形, 見unit-pkown3)
const shapesMore = [
    { nm: '繼承物件', kind: 'unset', mk: () => Object.assign(Object.create({ id: { x: 1 } }), { name: 'n' }) },
    { nm: '繼承空字串', kind: 'unset', mk: () => Object.assign(Object.create({ id: '' }), { name: 'n' }) },
    { nm: '類別getter(數字)', kind: 'unset', mk: () => Object.assign(new GetN(), { name: 'n' }) },
    { nm: '原型僅有getter之id', kind: 'unset', mk: () => Object.assign(Object.create(Object.defineProperty({}, 'id', { get: () => 'a9', enumerable: true, configurable: true })), { name: 'n' }) },
    { nm: 'Object.prototype被定義id(類別實例之列)', kind: 'unset', mk: () => Object.assign(new RowPlain(), { name: 'n' }), pollute: 'a9' },
    { nm: '自有存取器(複製為資料屬性)', kind: 'own', key: 'a9', mk: () => Object.defineProperty({ name: 'n' }, 'id', { get: () => 'a9', enumerable: true, configurable: true }) },
]
//FEW, 只對少數形狀加測之入口(insert單一物件、save不補寫)
const FEW = ['繼承字串', '自有可列舉']

//shapesInt, 整數主鍵表(ipk)之列形狀
const shapesInt = [
    { nm: '繼承數字', kind: 'unset', mk: () => Object.assign(Object.create({ id: 123 }), { name: 'n' }) },
    { nm: '自有不可列舉', kind: 'unset', mk: () => Object.defineProperty({ name: 'n' }, 'id', { value: 123, enumerable: false, writable: true, configurable: true }) },
    { nm: '自有可列舉', kind: 'own', key: 123, mk: () => ({ id: 123, name: 'n' }) },
]


//entries, 寫入與刪除入口
//註: call之第3參數o為option(Object.prototype被定義id之形狀須以預先初始化之instance呼叫, 見getOpt)
const entries = [
    { nm: 'insert([row])', mode: 'insert', call: (w, r, o) => w.insert([r], o) },
    { nm: 'insert(row)', mode: 'insert', call: (w, r, o) => w.insert(r, o), only: FEW },
    { nm: 'insertBulk([row])', mode: 'insertBulk', call: (w, r, o) => w.insertBulk([r], o) },
    { nm: 'save([row])', mode: 'save', call: (w, r, o) => w.save([r], o) },
    { nm: 'save([row], autoInsert:false)', mode: 'save0', call: (w, r, o) => w.save([r], { ...o, autoInsert: false }), only: FEW },
    { nm: 'del([row])', mode: 'del', call: (w, r, o) => w.del([r], o) },
]


//mask, 把自動產生之36碼主鍵遮為<uuid>
function mask(s) {
    return String(s).replace(NO_UUID, '<uuid>')
}


//withPollute, 呼叫期間(含非同步完成前)於Object.prototype定義不可列舉之id, 結束必還原
async function withPollute(sh, fn) {
    if (sh.pollute === undefined) {
        return fn()
    }
    Object.defineProperty(Object.prototype, 'id', { value: sh.pollute, enumerable: false, writable: true, configurable: true }) // eslint-disable-line no-extend-native
    try {
        return await fn()
    }
    finally {
        delete Object.prototype.id
    }
}


//siCache, 每個實例之預先初始化instance
let siCache = new WeakMap()


//getOpt, Object.prototype被定義id時連匯入model(sequelize)都會失敗(與本規則無關之既有限制), 故這類形狀以污染前即初始化之instance呼叫(option.instance), 其餘形狀不傳
async function getOpt(sh, w) {
    if (sh.pollute === undefined) {
        return {}
    }
    if (!siCache.has(w)) {
        siCache.set(w, await w.init())
    }
    return { instance: siCache.get(w) }
}


//observe, 執行入口並正規化結果: { rej: reject之訊息或null, res: 結果摘要 }
async function observe(sh, en, w) {
    let rej = null
    let res = null
    try {
        let o = await getOpt(sh, w)
        let r = await withPollute(sh, () => en.call(w, sh.mk(), o))
        if (Array.isArray(r)) {
            res = r.map((v) => {
                let o = { n: v.n, ok: v.ok }
                for (let k of ['nInserted', 'nModified', 'nDeleted', 'err']) {
                    if (v[k] !== undefined) {
                        o[k] = v[k]
                    }
                }
                return o
            })
        }
        else {
            res = { n: r.n, nInserted: r.nInserted, ok: r.ok }
        }
    }
    catch (err) {
        rej = mask(err && err.message)
    }
    return { rej, res }
}


//seedList, 初始列轉為與dump同形之字串陣列
function seedList(rows) {
    return rows.map((r) => `${r.id}=${r.name}`)
}


//expectStr, 字串主鍵表(users)之應然: P1~P3; seedName為none或has; 回傳{ rej, res, db }
function expectStr(sh, en, autoGenPk, seedName) {
    let base = seedList(seedsStr[seedName])
    let dbSame = [...base].sort()
    if (sh.kind === 'unset') {
        //P3 del: 繼承(或自有不可列舉)之主鍵視為未給, 該筆ok為0附既有訊息, 不刪同值列
        if (en.mode === 'del') {
            return { rej: null, res: [{ n: 0, ok: 0, nDeleted: 0, err: MSG_DEL }], db: dbSame }
        }
        //P1 autoGenPk為false: 照既有之未帶處置整批reject, 不寫入
        if (!autoGenPk) {
            return { rej: MSG_NOPK_OFF, res: null, db: dbSame }
        }
        //P1 autoGenPk為true: 補新主鍵(36碼), 同值列原封不動(P3: 不跳過、不撞鍵、不覆寫)
        let dbNew = [...base, '<uuid>=n'].sort()
        if (en.mode === 'insert' || en.mode === 'insertBulk') {
            return { rej: null, res: { n: 1, nInserted: 1, ok: 1 }, db: dbNew }
        }
        if (en.mode === 'save') {
            return { rej: null, res: [{ n: 1, ok: 1, nInserted: 1, nModified: 0 }], db: dbNew }
        }
        //save0: autoInsert為false, 新主鍵之列不存在而不寫
        return { rej: null, res: [{ n: 0, ok: 1, nInserted: 0, nModified: 0 }], db: dbSame }
    }
    //own(對照, 行為不變): 以自有主鍵值key操作
    let has = base.some((v) => v.startsWith(`${sh.key}=`))
    let dbWith = [...base.filter((v) => !v.startsWith(`${sh.key}=`)), `${sh.key}=n`].sort()
    let dbWithout = base.filter((v) => !v.startsWith(`${sh.key}=`)).sort()
    if (en.mode === 'insert') {
        return has
            ? { rej: null, res: { n: 1, nInserted: 0, ok: 1 }, db: dbSame }
            : { rej: null, res: { n: 1, nInserted: 1, ok: 1 }, db: dbWith }
    }
    if (en.mode === 'insertBulk') {
        return has
            ? { rej: 'dup', res: null, db: dbSame }
            : { rej: null, res: { n: 1, nInserted: 1, ok: 1 }, db: dbWith }
    }
    if (en.mode === 'save') {
        return has
            ? { rej: null, res: [{ n: 1, ok: 1, nInserted: 0, nModified: 1 }], db: dbWith }
            : { rej: null, res: [{ n: 1, ok: 1, nInserted: 1, nModified: 0 }], db: dbWith }
    }
    if (en.mode === 'save0') {
        return has
            ? { rej: null, res: [{ n: 1, ok: 1, nInserted: 0, nModified: 1 }], db: dbWith }
            : { rej: null, res: [{ n: 0, ok: 1, nInserted: 0, nModified: 0 }], db: dbSame }
    }
    //del
    return has
        ? { rej: null, res: [{ n: 1, ok: 1, nDeleted: 1 }], db: dbWithout }
        : { rej: null, res: [{ n: 0, ok: 1, nDeleted: 0 }], db: dbSame }
}


//expectInt, 整數主鍵表(ipk)之應然: 未帶時autoGenPk為true因主鍵欄非字串類而以既有訊息reject(補值產生字串), 為false照既有訊息reject
function expectInt(sh, en, autoGenPk, seedName) {
    let base = seedList(seedsInt[seedName])
    let dbSame = [...base].sort()
    if (sh.kind === 'unset') {
        if (en.mode === 'del') {
            return { rej: null, res: [{ n: 0, ok: 0, nDeleted: 0, err: MSG_DEL }], db: dbSame }
        }
        return { rej: autoGenPk ? 'INT_AUTOGEN' : MSG_NOPK_OFF, res: null, db: dbSame }
    }
    let has = base.some((v) => v.startsWith(`${sh.key}=`))
    let dbWith = [...base.filter((v) => !v.startsWith(`${sh.key}=`)), `${sh.key}=n`].sort()
    let dbWithout = base.filter((v) => !v.startsWith(`${sh.key}=`)).sort()
    if (en.mode === 'insert') {
        return has
            ? { rej: null, res: { n: 1, nInserted: 0, ok: 1 }, db: dbSame }
            : { rej: null, res: { n: 1, nInserted: 1, ok: 1 }, db: dbWith }
    }
    if (en.mode === 'insertBulk') {
        return has
            ? { rej: 'dup', res: null, db: dbSame }
            : { rej: null, res: { n: 1, nInserted: 1, ok: 1 }, db: dbWith }
    }
    if (en.mode === 'save') {
        return has
            ? { rej: null, res: [{ n: 1, ok: 1, nInserted: 0, nModified: 1 }], db: dbWith }
            : { rej: null, res: [{ n: 1, ok: 1, nInserted: 1, nModified: 0 }], db: dbWith }
    }
    return has
        ? { rej: null, res: [{ n: 1, ok: 1, nDeleted: 1 }], db: dbWithout }
        : { rej: null, res: [{ n: 0, ok: 1, nDeleted: 0 }], db: dbSame }
}


//chkObs, 比對觀察與應然; rej為'dup'者只要求reject(Jet之重複鍵訊息隨語系), 'INT_AUTOGEN'者比對固定詞彙之前綴
function chkObs(obs, exp, db, label) {
    //PKOWN_TRACE: 設為檔案路徑時逐格附記觀察(供產[入口 × 形狀 × 同值列]之修前修後表), 先於斷言故失敗之格亦記錄; 未設則無作用
    if (process.env.PKOWN_TRACE) {
        fs.appendFileSync(process.env.PKOWN_TRACE, `${JSON.stringify({ label, rej: obs.rej, res: obs.res, db })}\n`)
    }
    if (exp.rej === 'dup') {
        assert.strict.ok(obs.rej !== null, `${label}: 應reject(重複鍵)`)
    }
    else if (exp.rej === 'INT_AUTOGEN') {
        assert.strict.ok(obs.rej !== null && obs.rej.startsWith('autoGenPk is true but pk column [id] in model [ipk]'), `${label}: 應以既有訊息reject, 實為 ${obs.rej}`)
    }
    else {
        assert.strict.strictEqual(obs.rej, exp.rej, `${label}: reject訊息`)
    }
    assert.strict.deepStrictEqual(obs.res, exp.res, `${label}: 結果`)
    assert.strict.deepStrictEqual(db, exp.db, `${label}: 資料庫(同值列不得被跳過、覆寫或刪除; 不得寫入缺主鍵之列)`)
}


//initCtx, 建專屬暫存資料夾與mdb副本, 回傳操作工具
async function initCtx(nm) {
    let fdTmp = `./test/temp-${nm}`
    let fdModels = `${fdTmp}/models`
    let fpStorage = `${fdTmp}/${nm}.mdb`
    let wo = (await importSrc('WOrmMdb.mjs')).default
    let jetOpen = (await importSrc('jet.mjs')).default
    fs.rmSync(fdTmp, { recursive: true, force: true })
    fs.mkdirSync(fdModels, { recursive: true })
    fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpStorage)
    for (let fn of fs.readdirSync('./test/assets/models')) {
        fs.copyFileSync(path.join('./test/assets/models', fn), path.join(fdModels, fn))
    }
    let jet = jetOpen({ path: path.resolve(fpStorage), password: '' })

    function mkW(cl, ext = {}) {
        let w = wo({ url: 'mdb://:', db: 'worm', cl, fdModels, storage: fpStorage, ...ext })
        let evs = { error: [], change: [] }
        w.on('error', (mode, data, msg) => {
            evs.error.push({ mode, data, msg })
        })
        w.on('change', (mode) => {
            evs.change.push(mode)
        })
        return { w, evs }
    }

    async function seed(cl, rows) {
        let cmds = [{ type: 'execute', sql: `DELETE FROM [${cl}]` }]
        for (let r of rows) {
            let ks = Object.keys(r)
            cmds.push({ type: 'execute', sql: `INSERT INTO [${cl}] (${ks.map((k) => `[${k}]`).join(', ')}) VALUES (${ks.map((k) => (typeof r[k] === 'number' ? String(r[k]) : `'${r[k]}'`)).join(', ')})` })
        }
        let res = await jet.run(cmds)
        assert.strict.ok(res.ok, `seed ${cl} failed: ${res.error}`)
    }

    //dump, 以原生SQL讀全表, 回傳排序後之id=name字串陣列(自動產生之主鍵遮為<uuid>)
    async function dump(cl) {
        let rs = await jet.query(`SELECT * FROM [${cl}]`)
        return rs.map((r) => mask(`${r.id}=${r.name}`)).sort()
    }

    function cleanup() {
        cleanStorage(fdTmp)
    }

    //query, 原生SQL查詢(非id/name表用)
    function query(sql) {
        return jet.query(sql)
    }

    //run, 原生SQL執行
    async function run(cmds) {
        let res = await jet.run(cmds)
        assert.strict.ok(res.ok, `run failed: ${res.error}`)
    }

    return { mkW, seed, dump, query, run, cleanup }
}


export {
    seedsStr, seedsInt, shapesStr, shapesMore, shapesInt, entries, FEW,
    GetA, GetN, MSG_NOPK_OFF, MSG_DEL,
    mask, withPollute, getOpt, observe, expectStr, expectInt, chkObs, initCtx
}
