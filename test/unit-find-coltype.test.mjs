import fs from 'fs'
import path from 'path'
import assert from 'assert'
import Sequelize from 'sequelize'
import wo from '../src/WOrmMdb.mjs'
import * as qm from '../src/queryMemory.mjs'
import jetOpen from '../src/jet.mjs'
import { isWindows } from './unit-setup.mjs'


//spec: CLAUDE_rulebook.md之R-FLOAT-07(條件引用model宣告為非白名單欄型之欄一律拒收; 原LFL5〔TIME〕、LFL7)
//  白名單欄型 = reladb getColKind 之str(STRING TEXT CHAR CITEXT UUID)、int(INTEGER BIGINT SMALLINT MEDIUMINT TINYINT)、num(FLOAT REAL DOUBLE DECIMAL NUMBER)、date(DATE)、dateonly(DATEONLY)、bool(BOOLEAN)
//  T1 條件(含巢狀$and/$or、屬性名或資料庫欄名、任一運算子與值形式、null)引用被宣告為其他欄型(any: TIME ENUM JSON JSONB BLOB UUIDV1 UUIDV4 NOW ARRAY RANGE GEOMETRY GEOGRAPHY HSTORE INET CIDR MACADDR TSVECTOR)之欄者,
//     select與delAll一律整批reject, 訊息固定為[invalid find: column type <型別> is not supported at [路徑]]
//  T2 訊息不回顯條件值; 先於任何讀寫(不開啟資料庫檔、不讀全表、不刪除); 每次呼叫恰發一次error事件; select與delAll一致; 資料表不變
//  T3 不引用該欄者不受影響(含不帶條件之select()與delAll()、同表其他欄之條件); 白名單欄型照常, 命中集合與Jet原生比較一致(對照組)
//  T4 如實宣告者照舊(Jet沒有[僅時間]型別, 時間值以1899-12-30為日期, 宣告DATE即與Jet原生比較一致)
//背景: Jet欄型只有文字、數值、日期時間、是否等, 沒有ENUM/JSON/BLOB(OLE以外)/UUID(GUID以外)/TIME等; model宣告為這些必為誤宣告或無法對應;
//  reladb之getColKind將其歸any(不換算、不檢核值), 記憶體過濾表之欄不是CITEXT, 故條件依sqlite比較而與Jet原生不同:
//  文字欄分大小寫($ne 'APPLE'多命中apple), 日期時間欄以文字比較('T'與空白分隔不等, $ne多命中), TIME之$gt '12:00:00'多刪(第87項B4外審sol F01, 真Jet實證)
//本檔: 第一組TIME真Jet(公開API); 第二組17個any型別真Jet(逐型別宣告於文字、數值、日期時間欄); 第三組白名單欄型對照(真Jet); 第四組chkFindColKind純函數


let nm = 'find-coltype'
let fdTmp = `./test/temp-${nm}`

//Jet內之列(第一組用): 時間值以1899-12-30為日期(Access之[僅時間]值), 另有完整日期時間與NULL
const SEEDS_TIME = [
    ['morning', '#1899-12-30 08:30:00#'],
    ['late', '#1899-12-30 20:30:00#'],
    ['dated', '#2026-05-01 10:00:00#'],
    ['nul', 'NULL'],
]
const ALL_TIME = ['dated', 'late', 'morning', 'nul']

//第二、三組之列: name為文字、value為DOUBLE、n為INTEGER、dt為DATETIME、b為YESNO
const SEEDS_MIX = [
    ['r1', '\'apple\'', 5, 5, '#2020-01-01 10:00:00#', 0],
    ['r2', '\'banana\'', 10, 10, '#2026-05-01 10:00:00#', -1],
    ['r3', '\'cherry\'', 100, 100, '#2099-01-01 00:00:00#', 0],
    ['r4', 'NULL', 'NULL', 'NULL', 'NULL', 0],
]
const ALL_MIX = ['r1', 'r2', 'r3', 'r4']

const msg = (t, p) => `invalid find: column type ${t} is not supported at [${p}]`

//第一組之條件表: [標籤, 條件, 預期路徑]
const FINDS_TIME = [
    ['等值(時間字串)', { dt: '12:00:00' }, 'find.dt'],
    ['等值(完整日期時間字串)', { dt: '2026-05-01T10:00:00' }, 'find.dt'],
    ['$eq', { dt: { $eq: '08:30:00' } }, 'find.dt'],
    ['$ne', { dt: { $ne: '08:30:00' } }, 'find.dt'],
    ['$gt(修前多刪早於12:00者)', { dt: { $gt: '12:00:00' } }, 'find.dt'],
    ['$gte', { dt: { $gte: '12:00:00' } }, 'find.dt'],
    ['$lt', { dt: { $lt: '12:00:00' } }, 'find.dt'],
    ['$lte', { dt: { $lte: '12:00:00' } }, 'find.dt'],
    ['$in', { dt: { $in: ['08:30:00', '20:30:00'] } }, 'find.dt'],
    ['$nin', { dt: { $nin: ['08:30:00'] } }, 'find.dt'],
    ['$in空陣列', { dt: { $in: [] } }, 'find.dt'],
    ['等值null', { dt: null }, 'find.dt'],
    ['$ne null', { dt: { $ne: null } }, 'find.dt'],
    ['數值', { dt: { $gt: 5 } }, 'find.dt'],
    ['布林', { dt: true }, 'find.dt'],
    ['Date', { dt: new Date(2026, 0, 1) }, 'find.dt'],
    ['同欄多運算子', { dt: { $gte: '08:00:00', $lt: '21:00:00' } }, 'find.dt'],
    ['與他欄並列', { name: 'x', dt: { $gt: '12:00:00' } }, 'find.dt'],
    ['與主鍵並列', { id: 'late', dt: { $gt: '12:00:00' } }, 'find.dt'],
    ['$and內', { $and: [{ name: 'x' }, { dt: { $gt: '12:00:00' } }] }, 'find.$and[1].dt'],
    ['$or內', { $or: [{ id: 'late' }, { dt: '08:30:00' }] }, 'find.$or[1].dt'],
    ['巢狀$and/$or', { $and: [{ $or: [{ id: 'late' }, { name: 'x' }] }, { $or: [{ n: 1 }, { dt: { $lt: '12:00:00' } }] }] }, 'find.$and[1].$or[1].dt'],
]

//第二組之any型別(17): [名, DataTypes運算式]
const ANY_TYPES = [
    ['TIME', 'DataTypes.TIME'],
    ['ENUM', 'DataTypes.ENUM(\'apple\', \'banana\', \'cherry\', \'x\')'],
    ['JSON', 'DataTypes.JSON'],
    ['JSONB', 'DataTypes.JSONB'],
    ['BLOB', 'DataTypes.BLOB'],
    ['UUIDV4', 'DataTypes.UUIDV4'],
    ['UUIDV1', 'DataTypes.UUIDV1'],
    ['NOW', 'DataTypes.NOW'],
    ['ARRAY', 'DataTypes.ARRAY(DataTypes.TEXT)'],
    ['RANGE', 'DataTypes.RANGE(DataTypes.INTEGER)'],
    ['GEOMETRY', 'DataTypes.GEOMETRY'],
    ['GEOGRAPHY', 'DataTypes.GEOGRAPHY'],
    ['HSTORE', 'DataTypes.HSTORE'],
    ['INET', 'DataTypes.INET'],
    ['CIDR', 'DataTypes.CIDR'],
    ['MACADDR', 'DataTypes.MACADDR'],
    ['TSVECTOR', 'DataTypes.TSVECTOR'],
]

//第二組之條件: [欄, 條件, 路徑, Jet原生WHERE, Jet原生命中], 皆為修前記憶體過濾與Jet不同且方向為[多命中]者(delAll多刪)
//  name: 分大小寫使$ne 'APPLE'多命中apple; value(ENUM、BLOB): 文字序使$lt 50多命中100; dt: 空白分隔與T不等使$ne多命中
const HARMFUL = [
    ['name', { name: { $ne: 'APPLE' } }, 'find.name', '[name] <> \'APPLE\'', ['r2', 'r3']],
    ['value', { value: { $lt: 50 } }, 'find.value', '[value] < 50', ['r1', 'r2']],
    ['dt', { dt: { $ne: '2026-05-01 10:00:00' } }, 'find.dt', '[dt] <> #2026-05-01 10:00:00#', ['r1', 'r3']],
]

//第三組之白名單欄型對照: [標籤, 型別運算式, 欄, 條件表[[標籤, 條件, 原生WHERE]]]
const NAME_CONDS = [
    ['eq大小寫', { name: 'APPLE' }, '[name] = \'APPLE\''],
    ['ne大小寫', { name: { $ne: 'APPLE' } }, '[name] <> \'APPLE\''],
    ['gt', { name: { $gt: 'b' } }, '[name] > \'b\''],
    ['in大小寫', { name: { $in: ['APPLE', 'cherry'] } }, '[name] IN (\'APPLE\', \'cherry\')'],
]
const NUM_CONDS = (c) => [
    ['gt9', { [c]: { $gt: 9 } }, `[${c}] > 9`],
    ['lt50', { [c]: { $lt: 50 } }, `[${c}] < 50`],
    ['eq10', { [c]: 10 }, `[${c}] = 10`],
    ['ne10', { [c]: { $ne: 10 } }, `[${c}] <> 10`],
]
const DT_CONDS = [
    ['gt', { dt: { $gt: '2025-01-01T00:00:00' } }, '[dt] > #2025-01-01 00:00:00#'],
    ['lt', { dt: { $lt: '2026-05-01T10:00:00' } }, '[dt] < #2026-05-01 10:00:00#'],
    ['eq空白分隔', { dt: '2026-05-01 10:00:00' }, '[dt] = #2026-05-01 10:00:00#'],
    ['ne空白分隔', { dt: { $ne: '2026-05-01 10:00:00' } }, '[dt] <> #2026-05-01 10:00:00#'],
]
const BOOL_CONDS = [
    ['true', { b: true }, '[b] = -1'],
    ['false', { b: false }, '[b] = 0'],
    ['ne true', { b: { $ne: true } }, '[b] <> -1'],
]
const WHITE = [
    ['STRING', 'DataTypes.STRING', 'name', NAME_CONDS],
    ['TEXT', 'DataTypes.TEXT', 'name', NAME_CONDS],
    ['CHAR', 'DataTypes.CHAR', 'name', NAME_CONDS],
    ['CITEXT', 'DataTypes.CITEXT', 'name', NAME_CONDS],
    ['UUID', 'DataTypes.UUID', 'name', NAME_CONDS],
    ['INTEGER', 'DataTypes.INTEGER', 'n', NUM_CONDS('n')],
    ['BIGINT', 'DataTypes.BIGINT', 'n', NUM_CONDS('n')],
    ['SMALLINT', 'DataTypes.SMALLINT', 'n', NUM_CONDS('n')],
    ['MEDIUMINT', 'DataTypes.MEDIUMINT', 'n', NUM_CONDS('n')],
    ['TINYINT', 'DataTypes.TINYINT', 'n', NUM_CONDS('n')],
    ['DOUBLE', 'DataTypes.DOUBLE', 'value', NUM_CONDS('value')],
    ['FLOAT', 'DataTypes.FLOAT', 'value', NUM_CONDS('value')],
    ['REAL', 'DataTypes.REAL', 'value', NUM_CONDS('value')],
    ['DECIMAL', 'DataTypes.DECIMAL', 'value', NUM_CONDS('value')],
    ['NUMBER', 'DataTypes.NUMBER', 'value', NUM_CONDS('value')],
    ['BOOLEAN', 'DataTypes.BOOLEAN', 'b', BOOL_CONDS],
    ['DATE', 'DataTypes.DATE', 'dt', DT_CONDS],
]


function mkW(fp, cl, fdM) {
    let w = wo({ url: 'mdb://:', db: 'worm', cl, pk: 'id', fdModels: fdM, storage: fp })
    let evs = []
    let chs = []
    w.on('error', (e) => {
        evs.push(e)
    })
    w.on('change', (e) => {
        chs.push(e)
    })
    return { w, evs, chs }
}

async function readIds(fp) {
    let jet = jetOpen({ path: path.resolve(fp), password: '' })
    let rows = await jet.query('SELECT [id] FROM [tc]')
    return rows.map((v) => v.id).sort()
}

//rejMsg, 斷言promise確實reject(獨立旗標, 不以初始值推導)並回傳其訊息
async function rejMsg(pm, lb) {
    let state = 'resolved'
    let m = ''
    try {
        await pm
    }
    catch (e) {
        state = 'rejected'
        m = String((e && e.message) || e)
    }
    assert.strict.strictEqual(state, 'rejected', `${lb} 應reject`)
    return m
}

//mkModel, 複製tc.js並把指定欄宣告為指定型別運算式; patches為{欄: 運算式}
function mkModel(fd, patches) {
    fs.mkdirSync(fd, { recursive: true })
    let src = fs.readFileSync('./test/assets/models/tc.js', 'utf8').replace(/\r\n/g, '\n')
    for (let [col, expr] of Object.entries(patches)) {
        let re = new RegExp(`'${col}': \\{\\ntype: DataTypes\\.[A-Z]+`)
        let src2 = src.replace(re, () => `'${col}': {\ntype: ${expr}`)
        assert.strict.ok(re.test(src), `model須有欄${col}`)
        src = src2
    }
    fs.writeFileSync(path.join(fd, 'tc.js'), src)
}

//seedJet, 清空tc並寫入指定列
async function seedMix(fp) {
    let jet = jetOpen({ path: path.resolve(fp), password: '' })
    let r = await jet.run([
        { type: 'execute', sql: 'DELETE FROM [tc]' },
        ...SEEDS_MIX.map(([id, name, value, n, dt, b]) => ({
            type: 'execute',
            sql: `INSERT INTO [tc] ([id], [name], [value], [n], [dt], [b]) VALUES ('${id}', ${name}, ${value}, ${n}, ${dt}, ${b})`,
        })),
    ])
    if (!r.ok) {
        throw new Error(`seed failed: ${r.error}`)
    }
}


if (isWindows()) {

    describe('WOrmMdb TIME宣告欄之條件拒收: 真Jet公開API(R-FLOAT-07 T1–T4)', function() {

        let fdModels = `${fdTmp}/models-time`
        let fdModelsDate = `${fdTmp}/models-date`
        let fpTime = `${fdTmp}/seed-time.mdb`
        let nCopy = 0

        before(async function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            mkModel(fdModels, { dt: 'DataTypes.TIME' })
            mkModel(fdModelsDate, { dt: 'DataTypes.DATE' })
            fs.copyFileSync('./test/assets/worm_find_def.mdb', fpTime)
            let jet = jetOpen({ path: path.resolve(fpTime), password: '' })
            let r = await jet.run(SEEDS_TIME.map(([id, d]) => ({
                type: 'execute',
                sql: `INSERT INTO [tc] ([id], [name], [value], [n], [dt], [b]) VALUES ('${id}', 'x', 1, 1, ${d}, 0)`,
            })))
            if (!r.ok) {
                throw new Error(`seed failed: ${r.error}`)
            }
            assert.strict.deepStrictEqual(await readIds(fpTime), ALL_TIME, '種子')
        })

        after(function() {
            try {
                fs.rmSync(fdTmp, { recursive: true, force: true })
            }
            catch (err) {}
        })

        //cp, 取種子之新複本
        function cp() {
            nCopy++
            let fp = `${fdTmp}/ct${nCopy}.mdb`
            fs.copyFileSync(fpTime, fp)
            return fp
        }

        it(`select與delAll對${FINDS_TIME.length}種引用TIME欄之條件一律整批reject(T1), 訊息固定且不回顯值、每次恰一次error事件、無change事件、資料表不變(T2)`, async function() {
            assert.strict.strictEqual(FINDS_TIME.length, 22, '條件表格數')
            for (let [lb, find, p] of FINDS_TIME) {
                let fp = cp()
                let { w, evs, chs } = mkW(fp, 'tc', fdModels)
                let m1 = await rejMsg(w.select(find), `select ${lb}`)
                assert.strict.strictEqual(m1, msg('TIME', p), `select ${lb}`)
                assert.strict.strictEqual(evs.length, 1, `select ${lb} error事件數`)

                let m2 = await rejMsg(w.delAll(find), `delAll ${lb}`)
                assert.strict.strictEqual(m2, msg('TIME', p), `delAll ${lb}`)
                assert.strict.strictEqual(evs.length, 2, `delAll ${lb} error事件數`)
                assert.strict.strictEqual(chs.length, 0, `${lb} 無change事件`)
                assert.strict.deepStrictEqual(await readIds(fp), ALL_TIME, `${lb} 資料表不變(修前$gt:'12:00:00'會刪去morning與late)`)
            }
        })

        it('拒收先於任何讀寫: 資料庫檔不存在時, 引用TIME欄之select與delAll仍得TIME訊息(未開啟資料庫檔、未讀全表), 且不創建檔案', async function() {
            let fp = `${fdTmp}/not-exist.mdb`
            assert.strict.strictEqual(fs.existsSync(fp), false)
            let { w, evs } = mkW(fp, 'tc', fdModels)
            let m1 = await rejMsg(w.select({ dt: { $gt: '12:00:00' } }), 'select')
            assert.strict.strictEqual(m1, msg('TIME', 'find.dt'))
            let m2 = await rejMsg(w.delAll({ dt: { $gt: '12:00:00' } }), 'delAll')
            assert.strict.strictEqual(m2, msg('TIME', 'find.dt'))
            assert.strict.strictEqual(evs.length, 2)
            assert.strict.strictEqual(fs.existsSync(fp), false, '不創建檔案')
        })

        it('拒收次序: 形狀層(白名單)先於欄型檢核, 欄型檢核先於欄名與值型別檢核(同條件含不存在之欄或不合型別之值者得欄型訊息)', async function() {
            let { w, evs } = mkW(cp(), 'tc', fdModels)
            //形狀層: 白名單外之運算子, 先於載入model, 故不論是否引用TIME欄皆得白名單訊息
            let m0 = await rejMsg(w.select({ dt: { $regex: 'x' } }), 'select $regex')
            assert.strict.match(m0, /^invalid find: unsupported operator \[\$regex\] at \[find\.dt\.\$regex\]$/)
            //欄型檢核先於cvFind之欄名嚴格鍵
            let m1 = await rejMsg(w.select({ nosuch: 1, dt: 'x' }), 'select 不存在之欄')
            assert.strict.strictEqual(m1, msg('TIME', 'find.dt'))
            let m2 = await rejMsg(w.delAll({ $and: [{ nosuch: 1 }, { dt: { $gt: '12:00:00' } }] }), 'delAll 不存在之欄')
            assert.strict.strictEqual(m2, msg('TIME', 'find.$and[1].dt'))
            //不引用TIME欄而欄名不存在者, 仍由cvFind拒收
            let m3 = await rejMsg(w.select({ nosuch: 1 }), 'select 只有不存在之欄')
            assert.strict.match(m3, /^invalid find: unknown column name \[nosuch\] at \[find\.nosuch\]$/)
            assert.strict.strictEqual(evs.length, 4)
        })

        it('以option.instance共用實例亦同(select與delAll)', async function() {
            let fp = cp()
            let { w, evs } = mkW(fp, 'tc', fdModels)
            let instance = await w.init()
            try {
                let m1 = await rejMsg(w.select({ dt: { $lt: '12:00:00' } }, { instance }), 'select instance')
                assert.strict.strictEqual(m1, msg('TIME', 'find.dt'))
                let m2 = await rejMsg(w.delAll({ dt: { $lt: '12:00:00' } }, { instance }), 'delAll instance')
                assert.strict.strictEqual(m2, msg('TIME', 'find.dt'))
                assert.strict.strictEqual(evs.length, 2)
                assert.strict.deepStrictEqual(await readIds(fp), ALL_TIME)
            }
            finally {
                await instance.close()
            }
        })

        it('不引用TIME欄者不受影響(T3): 不帶條件之select()/delAll()、同表其他欄與主鍵之條件、$and/$or內不含該欄者', async function() {
            let fp = cp()
            let { w, evs } = mkW(fp, 'tc', fdModels)
            let ids = async(find) => (await w.select(find)).map((v) => v.id).sort()
            assert.strict.deepStrictEqual(await ids(), ALL_TIME, 'select()')
            assert.strict.deepStrictEqual(await ids({}), ALL_TIME, 'select({})')
            assert.strict.deepStrictEqual(await ids({ id: 'late' }), ['late'])
            assert.strict.deepStrictEqual(await ids({ name: 'x' }), ALL_TIME)
            assert.strict.deepStrictEqual(await ids({ $or: [{ id: 'late' }, { id: 'morning' }] }), ['late', 'morning'])
            assert.strict.deepStrictEqual(await ids({ $and: [{ name: 'x' }, { n: { $gte: 1 } }] }), ALL_TIME)
            let r1 = await w.delAll({ id: 'morning' })
            assert.strict.strictEqual(r1.nDeleted, 1)
            assert.strict.deepStrictEqual(await readIds(fp), ['dated', 'late', 'nul'])
            let r2 = await w.delAll()
            assert.strict.strictEqual(r2.nDeleted, 3)
            assert.strict.deepStrictEqual(await readIds(fp), [])
            assert.strict.strictEqual(evs.length, 0, '皆成功, 無error事件')
        })

        it('如實宣告為DATE者照舊(T4): 時間值以1899-12-30為日期, 範圍條件與Jet原生比較一致, delAll只刪命中者', async function() {
            let fp = cp()
            let jet = jetOpen({ path: path.resolve(fp), password: '' })
            //Jet原生: dt > 1899-12-30 12:00:00 命中late與dated
            let nat = (await jet.query('SELECT [id] FROM [tc] WHERE [dt] > #1899-12-30 12:00:00#')).map((v) => v.id).sort()
            assert.strict.deepStrictEqual(nat, ['dated', 'late'], 'Jet原生')
            let { w, evs } = mkW(fp, 'tc', fdModelsDate)
            let sel = (await w.select({ dt: { $gt: '1899-12-30T12:00:00' } })).map((v) => v.id).sort()
            assert.strict.deepStrictEqual(sel, nat, '宣告DATE之select與Jet原生一致')
            let r = await w.delAll({ dt: { $gt: '1899-12-30T12:00:00' } })
            assert.strict.strictEqual(r.nDeleted, 2)
            assert.strict.deepStrictEqual(await readIds(fp), ['morning', 'nul'])
            assert.strict.strictEqual(evs.length, 0)
        })

    })


    describe('WOrmMdb 其他any欄型宣告之條件拒收: 17型別 × 文字/數值/日期時間欄, 真Jet(R-FLOAT-07 T1–T2)', function() {

        let fdBase = `${fdTmp}-any`
        let fpAny = `${fdBase}/seed.mdb`
        let nCopy = 0

        before(async function() {
            fs.rmSync(fdBase, { recursive: true, force: true })
            fs.mkdirSync(fdBase, { recursive: true })
            fs.copyFileSync('./test/assets/worm_find_def.mdb', fpAny)
            await seedMix(fpAny)
            assert.strict.deepStrictEqual(await readIds(fpAny), ALL_MIX, '種子')
            for (let [tn, expr] of ANY_TYPES) {
                //name、value、dt三欄皆宣告為該型別
                mkModel(`${fdBase}/models-${tn}`, { name: expr, value: expr, dt: expr })
            }
        })

        after(function() {
            try {
                fs.rmSync(fdBase, { recursive: true, force: true })
            }
            catch (err) {}
        })

        it('前提(Jet原生): 三個[多命中]條件之原生命中集合 = 預期(文字不分大小寫、數值依數值、日期時間依時間); 修前記憶體過濾於any欄多命中而delAll多刪', async function() {
            let jet = jetOpen({ path: path.resolve(fpAny), password: '' })
            for (let [col, , , where, nat] of HARMFUL) {
                let got = (await jet.query(`SELECT [id] FROM [tc] WHERE ${where}`)).map((v) => v.id).sort()
                assert.strict.deepStrictEqual(got, nat, `${col} Jet原生`)
            }
        })

        it('型別表格數與條件表格數(格數為斷言常數, 防止表被清空而仍綠)', function() {
            assert.strict.strictEqual(ANY_TYPES.length, 17)
            assert.strict.strictEqual(HARMFUL.length, 3)
        })

        for (let [tn] of ANY_TYPES) {
            it(`${tn}宣告於name/value/dt: 引用該欄之條件(select與delAll)一律reject, 訊息帶該型別名稱, 每次恰一次error事件、無change事件、資料表不變`, async function() {
                nCopy++
                let fp = `${fdBase}/c${nCopy}.mdb`
                fs.copyFileSync(fpAny, fp)
                let { w, evs, chs } = mkW(fp, 'tc', `${fdBase}/models-${tn}`)
                let instance = await w.init()
                try {
                    let n = 0
                    for (let [col, find, p] of HARMFUL) {
                        let m1 = await rejMsg(w.select(find, { instance }), `${tn} select ${col}`)
                        assert.strict.strictEqual(m1, msg(tn, p), `${tn} select ${col}`)
                        let m2 = await rejMsg(w.delAll(find, { instance }), `${tn} delAll ${col}`)
                        assert.strict.strictEqual(m2, msg(tn, p), `${tn} delAll ${col}`)
                        n += 2
                        assert.strict.strictEqual(evs.length, n, `${tn} ${col} error事件數`)
                    }
                    //巢狀: 與他欄之$or
                    let find2 = { $or: [{ id: 'r1' }, { name: { $ne: 'APPLE' } }] }
                    let m3 = await rejMsg(w.delAll(find2, { instance }), `${tn} delAll 巢狀`)
                    assert.strict.strictEqual(m3, msg(tn, 'find.$or[1].name'), `${tn} 巢狀`)
                    assert.strict.strictEqual(chs.length, 0, `${tn} 無change事件`)
                    assert.strict.deepStrictEqual(await readIds(fp), ALL_MIX, `${tn} 資料表不變(修前name/dt欄多命中、ENUM/BLOB之value欄多命中而多刪)`)
                }
                finally {
                    await instance.close()
                }
            })
        }

        it('any型別之欄不被條件引用時不受影響: 同表以id、他欄(model未改寫之n/b)為條件照常, delAll只刪命中者(以ENUM宣告三欄為例)', async function() {
            nCopy++
            let fp = `${fdBase}/c${nCopy}.mdb`
            fs.copyFileSync(fpAny, fp)
            let { w, evs } = mkW(fp, 'tc', `${fdBase}/models-ENUM`)
            let ids = async(find) => (await w.select(find)).map((v) => v.id).sort()
            assert.strict.deepStrictEqual(await ids({ id: 'r2' }), ['r2'])
            assert.strict.deepStrictEqual(await ids({ n: { $gt: 9 } }), ['r2', 'r3'])
            assert.strict.deepStrictEqual(await ids({ $and: [{ n: { $lt: 50 } }, { b: false }] }), ['r1'])
            let r = await w.delAll({ n: { $gt: 9 } })
            assert.strict.strictEqual(r.nDeleted, 2)
            assert.strict.deepStrictEqual(await readIds(fp), ['r1', 'r4'])
            assert.strict.strictEqual(evs.length, 0)
        })

        it('VIRTUAL宣告之欄不在此判(非資料庫欄), 仍由cvFind以unknown column name拒收', async function() {
            nCopy++
            let fp = `${fdBase}/c${nCopy}.mdb`
            fs.copyFileSync(fpAny, fp)
            mkModel(`${fdBase}/models-VIRTUAL`, { name: 'DataTypes.VIRTUAL' })
            let { w } = mkW(fp, 'tc', `${fdBase}/models-VIRTUAL`)
            let m = await rejMsg(w.select({ name: 'apple' }), 'select virtual')
            assert.strict.match(m, /^invalid find: unknown column name \[name\] at \[find\.name\]$/)
            assert.strict.deepStrictEqual(await readIds(fp), ALL_MIX)
        })

    })


    describe('WOrmMdb 白名單欄型照常: 條件命中集合與Jet原生比較一致(R-FLOAT-07 T3 對照組)', function() {

        let fdBase = `${fdTmp}-white`
        let fpWhite = `${fdBase}/seed.mdb`

        before(async function() {
            fs.rmSync(fdBase, { recursive: true, force: true })
            fs.mkdirSync(fdBase, { recursive: true })
            fs.copyFileSync('./test/assets/worm_find_def.mdb', fpWhite)
            await seedMix(fpWhite)
            for (let [tn, expr, col] of WHITE) {
                mkModel(`${fdBase}/models-${tn}`, { [col]: expr })
            }
        })

        after(function() {
            try {
                fs.rmSync(fdBase, { recursive: true, force: true })
            }
            catch (err) {}
        })

        it(`${WHITE.length}個白名單欄型各宣告於相容之Jet欄: 每個條件之select命中集合 = Jet原生WHERE之命中集合(無reject), delAll之實刪集合同`, async function() {
            assert.strict.strictEqual(WHITE.length, 17, '白名單型別表格數')
            let nCase = 0
            let jet = jetOpen({ path: path.resolve(fpWhite), password: '' })
            for (let [tn, , col, conds] of WHITE) {
                let { w, evs } = mkW(fpWhite, 'tc', `${fdBase}/models-${tn}`)
                let instance = await w.init()
                try {
                    for (let [lb, find, where] of conds) {
                        let nat = (await jet.query(`SELECT [id] FROM [tc] WHERE ${where}`)).map((v) => v.id).sort()
                        let got = (await w.select(find, { instance })).map((v) => v.id).sort()
                        assert.strict.deepStrictEqual(got, nat, `${tn}@${col} ${lb} select`)
                        nCase++
                    }
                    assert.strict.strictEqual(evs.length, 0, `${tn} 無error事件`)
                }
                finally {
                    await instance.close()
                }
            }
            assert.strict.strictEqual(nCase, 5 * 4 + 5 * 4 + 5 * 4 + 3 + 4, '格數')
        })

        it('白名單欄型之delAll: 實刪集合 = Jet原生WHERE之命中集合(各取一個多命中風險之條件: 文字$ne大小寫、數值$lt、日期時間$ne空白分隔)', async function() {
            let cases = [
                ['STRING', 'name', { name: { $ne: 'APPLE' } }, '[name] <> \'APPLE\''],
                ['INTEGER', 'n', { n: { $lt: 50 } }, '[n] < 50'],
                ['DOUBLE', 'value', { value: { $lt: 50 } }, '[value] < 50'],
                ['DATE', 'dt', { dt: { $ne: '2026-05-01 10:00:00' } }, '[dt] <> #2026-05-01 10:00:00#'],
            ]
            for (let [tn, col, find, where] of cases) {
                let fp = `${fdBase}/d-${tn}.mdb`
                fs.copyFileSync(fpWhite, fp)
                let jet = jetOpen({ path: path.resolve(fp), password: '' })
                let nat = (await jet.query(`SELECT [id] FROM [tc] WHERE ${where}`)).map((v) => v.id).sort()
                let { w } = mkW(fp, 'tc', `${fdBase}/models-${tn}`)
                let r = await w.delAll(find)
                assert.strict.strictEqual(r.nDeleted, nat.length, `${tn}@${col} 筆數`)
                let left = await readIds(fp)
                assert.strict.deepStrictEqual(left, ALL_MIX.filter((id) => nat.indexOf(id) < 0), `${tn}@${col} 剩餘`)
            }
        })

        it('DATEONLY宣告於DATETIME欄(LFL6, 既有行為): 純日期字串條件被接受(不被欄型檢核拒收), 以日期粒度命中同日列', async function() {
            let fp = `${fdBase}/dateonly.mdb`
            fs.copyFileSync(fpWhite, fp)
            mkModel(`${fdBase}/models-DATEONLY`, { dt: 'DataTypes.DATEONLY' })
            let { w, evs } = mkW(fp, 'tc', `${fdBase}/models-DATEONLY`)
            let got = (await w.select({ dt: '2026-05-01' })).map((v) => v.id).sort()
            assert.strict.deepStrictEqual(got, ['r2'])
            assert.strict.strictEqual(evs.length, 0)
        })

    })

}


describe('chkFindColKind: 條件走訪與欄位解析(R-FLOAT-07, 純函數)', function() {

    //attrsOf, 以sequelize.define取得真正之rawAttributes
    function attrsOf(cols) {
        let sq = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
        let md = sq.define('tchk', { id: { type: Sequelize.STRING, primaryKey: true }, ...cols }, { timestamps: false })
        return md.rawAttributes
    }

    //thr, 斷言拋出指定訊息(獨立旗標)
    function thr(fn, m, lb) {
        let state = 'returned'
        let got = ''
        try {
            fn()
        }
        catch (e) {
            state = 'thrown'
            assert.strict.ok(e instanceof Error, `${lb} 應為Error`)
            got = e.message
        }
        assert.strict.strictEqual(state, 'thrown', `${lb} 應拋錯`)
        assert.strict.strictEqual(got, m, lb)
    }

    function ok(fn, lb) {
        assert.strict.doesNotThrow(fn, `${lb} 不應拋錯`)
    }

    const DT = Sequelize.DataTypes
    //any型別(19個getColKind歸any者中可宣告為欄者17個)的DataTypes運算式
    const ANY_MAKERS = {
        TIME: () => DT.TIME,
        ENUM: () => DT.ENUM('a', 'b'),
        JSON: () => DT.JSON,
        JSONB: () => DT.JSONB,
        BLOB: () => DT.BLOB,
        UUIDV1: () => DT.UUIDV1,
        UUIDV4: () => DT.UUIDV4,
        NOW: () => DT.NOW,
        ARRAY: () => DT.ARRAY(DT.TEXT),
        RANGE: () => DT.RANGE(DT.INTEGER),
        GEOMETRY: () => DT.GEOMETRY,
        GEOGRAPHY: () => DT.GEOGRAPHY,
        HSTORE: () => DT.HSTORE,
        INET: () => DT.INET,
        CIDR: () => DT.CIDR,
        MACADDR: () => DT.MACADDR,
        TSVECTOR: () => DT.TSVECTOR,
    }
    //白名單欄型
    const WHITE_MAKERS = {
        'STRING': () => DT.STRING,
        'STRING(10)': () => DT.STRING(10),
        'TEXT': () => DT.TEXT,
        'TEXT(tiny)': () => DT.TEXT('tiny'),
        'CHAR': () => DT.CHAR,
        'CITEXT': () => DT.CITEXT,
        'UUID': () => DT.UUID,
        'INTEGER': () => DT.INTEGER,
        'BIGINT': () => DT.BIGINT,
        'SMALLINT': () => DT.SMALLINT,
        'MEDIUMINT': () => DT.MEDIUMINT,
        'TINYINT': () => DT.TINYINT,
        'FLOAT': () => DT.FLOAT,
        'REAL': () => DT.REAL,
        'DOUBLE': () => DT.DOUBLE,
        'DECIMAL': () => DT.DECIMAL(10, 2),
        'NUMBER': () => DT.NUMBER,
        'BOOLEAN': () => DT.BOOLEAN,
        'DATE': () => DT.DATE,
        'DATEONLY': () => DT.DATEONLY,
    }

    it('匯出chkFindColKind函數', function() {
        assert.strict.strictEqual(typeof qm.chkFindColKind, 'function')
    })

    it('17個any型別(真正之rawAttributes)被條件引用皆拒收, 訊息帶該型別名稱、不含條件值; 路徑同cvFind之find.欄名', function() {
        assert.strict.strictEqual(Object.keys(ANY_MAKERS).length, 17)
        for (let [tn, mk] of Object.entries(ANY_MAKERS)) {
            let attrs = attrsOf({ x: { type: mk() } })
            thr(() => qm.chkFindColKind(attrs, { x: 'SECRET' }), msg(tn, 'find.x'), tn)
            thr(() => qm.chkFindColKind(attrs, { x: { $ne: null } }), msg(tn, 'find.x'), `${tn} $ne null`)
            thr(() => qm.chkFindColKind(attrs, { $and: [{ id: 'k' }, { $or: [{ id: 'j' }, { x: { $in: [1] } }] }] }), msg(tn, 'find.$and[1].$or[1].x'), `${tn} 巢狀`)
        }
    })

    it('20個白名單欄型(含STRING(10)、TEXT(tiny)、DECIMAL(10,2))被條件引用不拋錯', function() {
        assert.strict.strictEqual(Object.keys(WHITE_MAKERS).length, 20)
        for (let [tn, mk] of Object.entries(WHITE_MAKERS)) {
            let attrs = attrsOf({ x: { type: mk() } })
            ok(() => qm.chkFindColKind(attrs, { x: 'a' }), tn)
            ok(() => qm.chkFindColKind(attrs, { $and: [{ x: { $gt: 1 } }, { $or: [{ x: null }, { id: 'k' }] }] }), `${tn} 巢狀`)
        }
    })

    it('資料庫欄名(attr.field)引用亦拒收; TIME(3)亦同; 鍵序回報第一個; 屬性名優先於欄名解析', function() {
        let attrs = attrsOf({
            tm: { type: DT.TIME },
            tm3: { type: DT.TIME(3) },
            tmf: { type: DT.TIME, field: 'c_tm' },
            en: { type: DT.ENUM('a'), field: 'c_en' },
            d: { type: DT.DATE },
            s: { type: DT.STRING },
        })
        thr(() => qm.chkFindColKind(attrs, { tm: '12:00:00' }), msg('TIME', 'find.tm'), '屬性名')
        thr(() => qm.chkFindColKind(attrs, { tm3: { $gt: '12:00:00' } }), msg('TIME', 'find.tm3'), 'TIME(3)')
        thr(() => qm.chkFindColKind(attrs, { tmf: null }), msg('TIME', 'find.tmf'), '屬性名(欄名另設)')
        thr(() => qm.chkFindColKind(attrs, { c_tm: { $in: ['08:30:00'] } }), msg('TIME', 'find.c_tm'), '以資料庫欄名引用TIME')
        thr(() => qm.chkFindColKind(attrs, { c_en: 'a' }), msg('ENUM', 'find.c_en'), '以資料庫欄名引用ENUM')
        thr(() => qm.chkFindColKind(attrs, { s: 'a', en: 1, tm: 2 }), msg('ENUM', 'find.en'), '鍵序')
        thr(() => qm.chkFindColKind(attrs, { $or: [{ s: 'a' }, { $and: [{ d: { $lt: '2026-01-01T00:00:00' } }, { $or: [{ tm3: 1 }] }] }] }), msg('TIME', 'find.$or[1].$and[1].$or[0].tm3'), '深巢狀')
    })

    it('不引用any欄者不拋錯: 空條件、白名單欄、$and/$or內不含any欄、白名單外之$鍵與不存在之欄(留給cvFind拒收)', function() {
        let attrs = attrsOf({ tm: { type: DT.TIME }, d: { type: DT.DATE }, s: { type: DT.STRING } })
        ok(() => qm.chkFindColKind(attrs, {}), '空條件')
        ok(() => qm.chkFindColKind(attrs, { d: { $gt: '2026-01-01T00:00:00' }, s: 'a', id: 'k' }), '白名單欄')
        ok(() => qm.chkFindColKind(attrs, { $and: [{ s: 'a' }, { $or: [{ d: '2026-01-01T00:00:00' }, { id: 'k' }] }] }), '巢狀不含any')
        ok(() => qm.chkFindColKind(attrs, { $nor: [{ tm: 1 }] }), '白名單外之$鍵不在此判')
        ok(() => qm.chkFindColKind(attrs, { nosuch: 1 }), '不存在之欄交cvFind拒收')
        ok(() => qm.chkFindColKind({}, { x: 1 }), '空attrs')
        ok(() => qm.chkFindColKind(undefined, { x: 1 }), '無attrs')
    })

    it('VIRTUAL欄(非資料庫欄)不在此判, 交cvFind以unknown column name拒收', function() {
        let attrs = attrsOf({ v: { type: DT.VIRTUAL } })
        ok(() => qm.chkFindColKind(attrs, { v: 1 }), 'VIRTUAL')
    })

    it('以type.key判定(重複安裝兩份sequelize時instanceof不可靠): 手造attrs之type只有key; 型別無key或key異常者視為unknown而拒收', function() {
        let a1 = { x: { type: { key: 'TIME' } }, y: { type: { key: 'DATE' } }, z: { type: { key: 'STRING' } }, q: { type: { key: 'ENUM' } } }
        thr(() => qm.chkFindColKind(a1, { x: 1 }), msg('TIME', 'find.x'), 'key=TIME')
        thr(() => qm.chkFindColKind(a1, { q: 1 }), msg('ENUM', 'find.q'), 'key=ENUM')
        ok(() => qm.chkFindColKind(a1, { y: 1, z: 'a' }), 'key=DATE、STRING')
        //無type或key非字串/含異常字元: fail-closed, 固定詞彙unknown(不回顯model內容)
        let a2 = { n1: {}, n2: { type: {} }, n3: { type: { key: 123 } }, n4: { type: { key: 'EVIL\'; DROP' } }, n5: { type: { key: 'a'.repeat(200) } } }
        for (let k of Object.keys(a2)) {
            thr(() => qm.chkFindColKind(a2, { [k]: 1 }), msg('unknown', `find.${k}`), `${k}`)
        }
    })

    it('不改動輸入, 不回顯條件值(含非字串值)', function() {
        let attrs = attrsOf({ tm: { type: DT.TIME } })
        let find = { tm: { $gt: '12:00:00-SECRET' } }
        let snap = JSON.stringify(find)
        let m = ''
        try {
            qm.chkFindColKind(attrs, find)
        }
        catch (e) {
            m = e.message
        }
        assert.strict.strictEqual(m, msg('TIME', 'find.tm'), '完整訊息相等(固定詞彙, 不含條件值)')
        assert.strict.strictEqual(JSON.stringify(find), snap, '輸入不被改動')
    })

})
