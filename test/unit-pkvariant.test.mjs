/* eslint-disable no-new-wrappers */ //本檔刻意以new String、new Number建構包裝物件, 驗證主鍵之拆包處置
import fs from 'fs'
import path from 'path'
import assert from 'assert'
import Sequelize from 'sequelize'
import wo from '../src/WOrmMdb.mjs'
import jetOpen from '../src/jet.mjs'
import { escVal } from '../src/getCmd.mjs'
import { isWindows, cleanStorage, getRt } from './unit-setup.mjs'


//spec: w-orm系列套件統一規格.md
//  selectByPk: 命中回數據物件且內容與select({主鍵})[0]相同(:260)、主鍵值無效(未給、型別不符)回null不reject(:262)、
//  命中之判定基準須與insert、save、del一致(:265)
//  insert: 已存在者跳過且不覆寫(:269)、全數已存在不得reject(:279)、同批重複僅首筆計入(:280)
//  insertBulk: 撞既有主鍵整批reject且不寫入(:313)
//  T6: 未帶有效主鍵依autoGenPk補值或reject(:91、:100), del之無效主鍵該筆ok為0(:114)
//  w-orm-mdb段之主鍵規則: 見CLAUDE_rulebook.md之R-PK(主鍵等值以Jet為準、依主鍵欄型別正規化、不可能存在之值不送Jet)


let nm = 'pkvariant'
let fdTmp = `./test/temp-${nm}`
let fdModels = `${fdTmp}/models`
let fpStorage = `${fdTmp}/${nm}.mdb`

const S255 = 'x'.repeat(255)
const Op = Sequelize.Op
const E255 = 'é'.repeat(255)


describe('WOrmMdb pkvariant normPk純函數', function() {

    //動態載入, 令模組不存在時僅本段失敗而不影響其餘段落之執行
    let pk = null
    before(async function() {
        pk = await import('../src/pk.mjs')
    })

    it('字串類主鍵欄: 非空字串原樣、有限數字轉String(v)', function() {
        //R-PK-02; Q1裁示String(v), 與w-serv-orm一致
        assert.strict.deepStrictEqual(pk.normPk('k2', 'str'), { kind: 'ok', v: 'k2' })
        assert.strict.deepStrictEqual(pk.normPk(123, 'str'), { kind: 'ok', v: '123' })
        assert.strict.deepStrictEqual(pk.normPk(-0, 'str'), { kind: 'ok', v: '0' })
        assert.strict.deepStrictEqual(pk.normPk(1e21, 'str'), { kind: 'ok', v: '1e+21' })
        assert.strict.deepStrictEqual(pk.normPk(S255, 'str'), { kind: 'ok', v: S255 })
    })

    it('字串類主鍵欄: 超過255字元、含NUL、孤立代理為不可能存在', function() {
        //R-PK-02 cannot
        assert.strict.strictEqual(pk.normPk(S255 + 'y', 'str').kind, 'cannot')
        assert.strict.strictEqual(pk.normPk('a\u0000b', 'str').kind, 'cannot')
        assert.strict.strictEqual(pk.normPk('s\uD800', 'str').kind, 'cannot')
        assert.strict.strictEqual(pk.normPk('s\uDC00x', 'str').kind, 'cannot')
        assert.strict.strictEqual(pk.normPk('😀', 'str').kind, 'ok', '成對代理為良構')
    })

    it('無效值: 空字串、±Infinity、NaN、布林、物件、陣列、Date、BigInt、null、undefined', function() {
        //R-PK-02 invalid; Q6裁示±Infinity無效
        let vs = ['', Infinity, -Infinity, NaN, true, false, {}, [], ['k2'], new Date(), 10n, null, undefined]
        for (let tp of ['str', 'int', 'flt', 'other']) {
            for (let v of vs) {
                assert.strict.strictEqual(pk.normPk(v, tp).kind, 'invalid', `${tp} ${String(v)}`)
            }
        }
    })

    it('包裝物件先拆包', function() {
        assert.strict.deepStrictEqual(pk.normPk(new String('k2'), 'str'), { kind: 'ok', v: 'k2' })
        assert.strict.strictEqual(pk.normPk(new String(''), 'str').kind, 'invalid')
        assert.strict.deepStrictEqual(pk.normPk(new Number(12), 'int'), { kind: 'ok', v: 12 })
        assert.strict.strictEqual(pk.normPk(new Number(NaN), 'str').kind, 'invalid')
    })

    it('整數類主鍵欄: 整數與標準整數字串為ok, 其餘為型別不符', function() {
        //R-PK-02; Q2裁示N1
        assert.strict.deepStrictEqual(pk.normPk(12, 'int'), { kind: 'ok', v: 12 })
        assert.strict.deepStrictEqual(pk.normPk('12', 'int'), { kind: 'ok', v: 12 })
        assert.strict.deepStrictEqual(pk.normPk('-5', 'int'), { kind: 'ok', v: -5 })
        for (let v of ['012', '12 ', ' 12', '12.4', '1e1', 'abc', '-0', 12.4, 12.5]) {
            assert.strict.strictEqual(pk.normPk(v, 'int').kind, 'mismatch', String(v))
        }
    })

    it('浮點類主鍵欄: 有限數字與標準數字字串為ok', function() {
        assert.strict.deepStrictEqual(pk.normPk(0.1, 'flt'), { kind: 'ok', v: 0.1 })
        assert.strict.deepStrictEqual(pk.normPk('0.1', 'flt'), { kind: 'ok', v: 0.1 })
        assert.strict.strictEqual(pk.normPk('.1', 'flt').kind, 'mismatch')
        assert.strict.strictEqual(pk.normPk('abc', 'flt').kind, 'mismatch')
    })

    it('其他型別主鍵欄: 非空字串與有限數字原樣', function() {
        assert.strict.deepStrictEqual(pk.normPk('abc', 'other'), { kind: 'ok', v: 'abc' })
        assert.strict.deepStrictEqual(pk.normPk(5, 'other'), { kind: 'ok', v: 5 })
    })

    it('型別清單: 字串類含UUID, 由model之type.key判定', function() {
        //R-PK-01; F8
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'UUID' } } }, 'id'), 'str')
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'STRING' } } }, 'id'), 'str')
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'INTEGER' } } }, 'id'), 'int')
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'DOUBLE PRECISION' } } }, 'id'), 'flt', 'sequelize之DOUBLE之key')
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'FLOAT' } } }, 'id'), 'flt')
        assert.strict.strictEqual(pk.getPkType({ id: { type: { key: 'DATE' } } }, 'id'), 'other')
        assert.strict.strictEqual(pk.getPkType({}, 'id'), 'other')
    })

    it('kFast只折尾端半形空白與ASCII大小寫(只會少判不會多判)', function() {
        //R-PK-04
        assert.strict.strictEqual(pk.kFast('K2 '), pk.kFast('k2'))
        assert.strict.strictEqual(pk.kFast('k2  '), pk.kFast('K2'))
        assert.strict.notStrictEqual(pk.kFast('É'), pk.kFast('é'))
        assert.strict.notStrictEqual(pk.kFast(' k2'), pk.kFast('k2'))
        assert.strict.notStrictEqual(pk.kFast('ı'), pk.kFast('I'))
    })

    it('超過255字元之判定不計尾端半形空白, 且其他型別主鍵欄亦適用', function() {
        //Jet比對時忽略尾端半形空白, 寫入時亦可容納於上限內; model未定義主鍵欄時型別為other, 實體欄仍可能為文字
        assert.strict.deepStrictEqual(pk.normPk(S255 + '  ', 'str'), { kind: 'ok', v: S255 + '  ' })
        assert.strict.strictEqual(pk.normPk(S255 + 'y', 'other').kind, 'cannot')
        assert.strict.deepStrictEqual(pk.normPk(S255, 'other'), { kind: 'ok', v: S255 })
    })

    it('castPkFind: 主鍵等值類條件改寫為序號條件並併入同一物件(不增層), 範圍留於原欄', function() {
        //R-PK-05、R-WL-03、R-FIND-03(第33項批2: 輸入為cvOrmFind之複本, 無陣列值/$not/$regex; 序號條件併入同一物件, 而非Symbol Op.and〔被reladb 1.1.10之cvFind reject〕或額外$and層〔使合法巢狀深度放大, 外審sol F02〕)
        //idxOf為測試用之命中表; castPkFind單趟走訪回傳{find, slots}, 序號以fillPkSlots填入; 空集合以-1表示, 其餘為空時不放{}
        let io = (v) => {
            return v === 'k2' ? [0] : (v === 'a' ? [1] : [])
        }
        let cpf = (find, tp = 'str', pkName = 'id') => {
            let r = pk.castPkFind(find, pkName, tp, 'W')
            pk.fillPkSlots(r.slots, io)
            return r.find
        }
        assert.strict.deepStrictEqual(cpf({ id: 'k2' }), { W: { $in: [0] } })
        assert.strict.deepStrictEqual(cpf({ id: { $eq: 'k2' } }), { W: { $in: [0] } })
        assert.strict.deepStrictEqual(cpf({ id: { $in: ['k2', 'a', 'zz'] } }), { W: { $in: [0, 1] } })
        assert.strict.deepStrictEqual(cpf({ id: 'zz' }), { W: { $in: [-1] } }, '未命中以不存在之序號表示')
        assert.strict.deepStrictEqual(cpf({ id: { $ne: 'zz' } }), { W: { $nin: [-1] } }, '$ne未命中之值為恆成立')
        assert.strict.deepStrictEqual(cpf({ id: { $nin: ['k2', 'a'] } }), { W: { $nin: [0, 1] } })
        assert.strict.deepStrictEqual(cpf({ id: { $ne: 'k2' }, $and: [{ name: 'x' }] }), { $and: [{ name: 'x' }], W: { $nin: [0] } }, '序號條件併入同一物件, 不增層, 不併入呼叫端之$and')
        assert.strict.deepStrictEqual(cpf({ id: { $gte: 5 } }), { id: { $gte: '5' } }, '範圍運算子以正規化值留於原欄')
        assert.strict.deepStrictEqual(cpf({ $or: [{ id: 'k2' }, { name: 'x' }] }), { $or: [{ W: { $in: [0] } }, { name: 'x' }] }, '$or內之元素逐一改寫')
        assert.strict.deepStrictEqual(cpf({ id: { $ne: 'k2', $in: ['a'] } }), { W: { $nin: [0], $in: [1] } }, '不同運算子併入同一運算子物件')
        assert.strict.deepStrictEqual(cpf({ id: { $eq: 'k2', $in: ['a'] } }), { $and: [{ W: { $in: [0] } }, { W: { $in: [1] } }] }, '同運算子重複才另以字串鍵$and置放')
        assert.strict.deepStrictEqual(cpf({ $and: [{ id: { $ne: S255 + 'y' } }, { name: 'x' }] }), { $and: [{ W: { $nin: [-1] } }, { name: 'x' }] }, '邏輯陣列之元素其主鍵條件皆化簡掉者以恆真之序號條件代替空物件(外審sol F01)')
        assert.strict.deepStrictEqual(cpf({ $or: [{ id: { $nin: [S255 + 'y'] } }, { id: 'k2' }] }), { $or: [{ W: { $nin: [-1] } }, { W: { $in: [0] } }] })
        //深度: 每層含主鍵條件者不增層(外審sol F02)
        let deep = (n) => {
            let f = { id: 'k2' }
            for (let i = 0; i < n; i++) {
                f = { id: { $ne: 'a' }, $and: [f] }
            }
            return f
        }
        let depthOf = (o) => {
            if (o === null || typeof o !== 'object') {
                return 0
            }
            let m = 0
            for (let k of Reflect.ownKeys(o)) {
                m = Math.max(m, depthOf(o[k]))
            }
            return m + (Array.isArray(o) ? 0 : 1)
        }
        assert.strict.strictEqual(depthOf(cpf(deep(16))), depthOf(deep(16)) + 1, '16層含主鍵之巢狀改寫後僅多運算子物件之一層(wi: {$in}), 不隨層數倍增')
        let walk = (o, acc = []) => {
            if (o !== null && typeof o === 'object') {
                for (let k of Reflect.ownKeys(o)) {
                    acc.push(k)
                    walk(o[k], acc)
                }
            }
            return acc
        }
        let ks = walk(cpf({ id: { $ne: 'k2', $in: ['a'] }, $or: [{ id: 'k2' }, { id: { $nin: ['a'] } }] }))
        assert.strict.deepStrictEqual(ks.filter((k) => typeof k === 'symbol'), [], '輸出不得含Symbol鍵(白名單拒收)')
    })

    it('castPkFind: Symbol鍵、length鍵、近似鍵與非一般物件原樣保留(交cvFind拒收)', function() {
        //R-FIND-02/03: 不得於cvFind之前丟棄條件(1.0.35以lodash each走訪而使條件變{}, delAll刪光全表); Symbol鍵與白名單外運算子不辨識亦不改寫, 由cvFind再拒
        let io = (v) => {
            return v === 'k2' ? [0] : []
        }
        let cpf = (find, tp = 'str', pkName = 'id') => {
            let r = pk.castPkFind(find, pkName, tp, 'W')
            pk.fillPkSlots(r.slots, io)
            return r.find
        }
        assert.strict.deepStrictEqual(cpf({ length: 0 }), { length: 0 })
        assert.strict.deepStrictEqual(cpf({ [Op.or]: [{ id: 'k2' }] }), { [Op.or]: [{ id: 'k2' }] }, 'Symbol鍵不辨識, 原樣交cvFind拒收')
        assert.strict.deepStrictEqual(cpf({ id: { [Op.in]: ['k2'] } }), { id: { [Op.in]: ['k2'] } }, '主鍵欄之Op.in亦不比照$in, 原樣交cvFind拒收')
        let d = new Date()
        assert.strict.strictEqual(cpf(d), d, '非一般物件原樣返回, 交cvFind拒收')
        assert.strict.deepStrictEqual(cpf({ ID: 'k2' }), { ID: 'k2' }, '近似鍵不視為主鍵, 原樣交cvFind由嚴格鍵拒收')
        assert.strict.deepStrictEqual(cpf({ id: 'k2' }, 'str', null), { id: 'k2' }, 'pk為null(model無此屬性)時不辨識主鍵條件, 交cvFind以嚴格鍵拒收')
        assert.strict.deepStrictEqual(cpf({ id: { $regex: 'k', $gte: 5 } }), { id: { $regex: 'k', $gte: '5' } }, '白名單外運算子不辨識, 留於原欄交cvFind拒收')
        assert.strict.deepStrictEqual(cpf({ $not: { id: 'k2' } }), { $not: { id: 'k2' } }, '$not不再辨識(已移除), 原樣交cvFind拒收')
    })

    it('castPkFind: 單趟走訪, 每個條件值只讀一次', function() {
        //R-FIND-02/03(run02外審opus、sol; 第33項批2: 輸入已為cvOrmFind之複本, 此處以讀取計數之Proxy驗證castPkFind本身單趟)
        let reads = 0
        let o = new Proxy({ id: { $ne: 'k2' } }, {
            get(t, k, r) {
                if (k === 'id') {
                    reads++
                }
                return Reflect.get(t, k, r)
            },
        })
        let r = pk.castPkFind(o, 'id', 'str', 'W')
        assert.strict.deepStrictEqual(r.slots.map((x) => x.vals), [['k2']])
        assert.strict.strictEqual(reads, 1, '主鍵欄之條件值只讀一次')
        let fake = { [Symbol.toStringTag]: 'String', valueOf: () => 'k2' }
        assert.strict.throws(() => pk.castPkFind({ id: { $nin: [fake] } }, 'id', 'str', 'W'), '偽造之包裝物件為無效值, 否定語境拋出')
        assert.strict.deepStrictEqual(pk.castPkFind({ id: { $eq: fake } }, 'id', 'str', 'W'), { find: { W: { $in: [-1] } }, slots: [] }, '肯定語境不命中(無佔位)')
    })

    it('castPkFind: 非運算子物件為無效值, 肯定語境不命中、否定語境拋出', function() {
        //修正初版把{}當成運算子物件而使主鍵條件消失, delAll({id:{}})因而刪光全表(cvOrmFind已拒空運算子物件, 此為單獨呼叫castPkFind時之防線)
        let io = () => {
            return [0]
        }
        let cpf = (find, tp = 'str') => {
            let r = pk.castPkFind(find, 'id', tp, 'W')
            pk.fillPkSlots(r.slots, io)
            return r.find
        }
        assert.strict.deepStrictEqual(cpf({ id: {} }), { W: { $in: [-1] } })
        assert.strict.deepStrictEqual(cpf({ id: undefined }), { W: { $in: [-1] } })
        assert.strict.deepStrictEqual(cpf({ id: null }), { W: { $in: [-1] } }, 'null為無效主鍵值, 肯定語境不命中')
        assert.strict.throws(() => cpf({ id: { $ne: undefined } }))
        assert.strict.throws(() => cpf({ id: { $ne: null } }), /^Error: invalid find: invalid primary key value in negative condition at \[find\.id\.\$ne\]$/, 'null於否定語境拋出(LW2), 格式同cvOrmFind且不回顯值(外審opus F5)')
        assert.strict.throws(() => cpf({ $or: [{ name: 'x' }, { $and: [{ id: { $nin: ['k2', ''] } }] }] }), /at \[find\.\$or\[1\]\.\$and\[0\]\.id\.\$nin\]$/, '錯誤路徑與原始find同形')
        assert.strict.throws(() => cpf({ id: { $ne: true } }), '布林於否定語境拋出')
        assert.strict.throws(() => cpf({ id: { $nin: ['a', NaN] } }))
        assert.strict.throws(() => cpf({ id: { $ne: '012' } }, 'int'), '型別不符於否定語境亦拋出')
        assert.strict.deepStrictEqual(cpf({ id: { $ne: S255 + 'y' } }), {}, '不可能存在之值於否定語境為必不相等')
    })

})


if (isWindows()) {
    describe('WOrmMdb pkvariant', function() {

        let jet = null
        let ws = {}

        function mk(cl, ext = {}) {
            let w = wo({
                url: 'mdb://:',
                db: 'worm',
                cl,
                fdModels,
                storage: fpStorage,
                ...ext,
            })
            w.on('error', function() {})
            return w
        }

        //seed, 以原生SQL清表並寫入初始列, 不經受測函數
        async function seed(cl, rows, pkName = 'id') {
            let cmds = [{ type: 'execute', sql: `DELETE FROM [${cl}]` }]
            for (let r of rows) {
                let ks = Object.keys(r)
                cmds.push({ type: 'execute', sql: `INSERT INTO [${cl}] (${ks.map((k) => `[${k}]`).join(', ')}) VALUES (${ks.map((k) => escVal(r[k])).join(', ')})` })
            }
            let res = await jet.run(cmds)
            assert.strict.ok(res.ok, `seed ${cl} failed: ${res.error}`)
        }

        //all, 以原生SQL讀全表
        async function all(cl) {
            return jet.query(`SELECT * FROM [${cl}]`)
        }

        async function ids(cl, pkName = 'id') {
            return (await all(cl)).map((r) => r[pkName])
        }

        before(function() {
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdModels, { recursive: true })
            fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpStorage)
            for (let fn of fs.readdirSync('./test/assets/models')) {
                fs.copyFileSync(path.join('./test/assets/models', fn), path.join(fdModels, fn))
            }
            jet = jetOpen({ path: path.resolve(fpStorage), password: '' })
            ws.users = mk('users')
            ws.ipk = mk('ipk')
            ws.dpk = mk('dpk')
            ws.upk = mk('upk')
            ws.uqx = mk('uqx')
            ws.tt = mk('tt')
        })

        after(function() {
            cleanStorage(fdTmp)
        })

        const SEED_U = [
            { id: 'k2', name: 'k2row' },
            { id: 'abc', name: 'abcrow' },
            { id: 'k4 ', name: 'k4sp' },
            { id: 'é', name: 'e-acute' },
            { id: 'A1', name: 'a1row' },
            { id: 'カ', name: 'kata' },
            { id: 'ß', name: 'eszett' },
            { id: 'ς', name: 'final-sigma' },
        ]

        describe('Jet等值變體 × 七函數(R-PK-04、05)', function() {

            let cases = [['大小寫', 'K2', 'k2'], ['尾端空白', 'k2 ', 'k2'], ['大小寫+尾端空白', 'K2 ', 'k2'], ['存值帶尾端空白', 'k4', 'k4 '],
                ['全形寬度', 'Ａ１', 'A1'], ['平假名對片假名', 'か', 'カ'], ['ß對ss', 'ss', 'ß'], ['ς對σ', 'σ', 'ς'], ['非ASCII大小寫', 'É', 'é']]

            for (let [lb, v, stored] of cases) {
                it(`${lb}: ${JSON.stringify(v)} 與存值 ${JSON.stringify(stored)} 於七函數皆判為同鍵`, async function() {
                    let w = ws.users
                    let nameStored = SEED_U.find((r) => r.id === stored).name

                    await seed('users', SEED_U)
                    //selectByPk命中且內容與select({主鍵})[0]相同(:260、:265)
                    let a = await w.selectByPk(v)
                    assert.strict.ok(a !== null && a.id === stored, 'selectByPk須命中存值')
                    let b = (await w.select({ id: v }))[0]
                    assert.strict.deepStrictEqual(a, b, 'select({主鍵})[0]須與selectByPk相同')
                    assert.strict.strictEqual((await w.select({ id: { $in: [v] } })).length, 1, 'select之$in須命中')
                    //insert視為已存在而跳過, 不覆寫, 不reject(:269、:279)
                    assert.strict.deepStrictEqual(await w.insert([{ id: v, name: 'INS' }]), { n: 1, nInserted: 0, ok: 1 })
                    assert.strict.strictEqual((await w.selectByPk(stored)).name, nameStored, '既有數據不得被覆寫')
                    //insertBulk視為衝突而整批reject且不寫入(:313)
                    assert.strict.strictEqual(await getRt(w.insertBulk([{ id: v, name: 'IB' }])), 'reject')
                    assert.strict.strictEqual((await all('users')).length, SEED_U.length)
                    //save改寫該列(:265)
                    assert.strict.deepStrictEqual(await w.save([{ id: v, name: 'SV' }]), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                    assert.strict.strictEqual((await w.selectByPk(stored)).name, 'SV')
                    assert.strict.strictEqual((await all('users')).length, SEED_U.length, 'save不得無中生有')
                    //del刪除該列(:265)
                    assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 1, nDeleted: 1, ok: 1 }])
                    assert.strict.ok(!(await ids('users')).includes(stored))

                    await seed('users', SEED_U)
                    //delAll與del一致(:265)
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 1, nDeleted: 1, ok: 1 })
                    assert.strict.ok(!(await ids('users')).includes(stored))
                })
            }

            it('異鍵(前導空白、尾端Tab)於七函數皆判為不存在', async function() {
                let w = ws.users
                for (let v of [' k2', 'k2\t']) {
                    await seed('users', SEED_U)
                    assert.strict.strictEqual(await w.selectByPk(v), null)
                    assert.strict.deepStrictEqual(await w.select({ id: v }), [])
                    assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 0, nDeleted: 0, ok: 1 }])
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 0, nDeleted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.save([{ id: v, name: 'svn' }], { autoInsert: false }), [{ n: 0, nInserted: 0, nModified: 0, ok: 1 }])
                    assert.strict.deepStrictEqual(await w.insert([{ id: v, name: 'new' }]), { n: 1, nInserted: 1, ok: 1 })
                    assert.strict.strictEqual((await all('users')).length, SEED_U.length + 1)
                    await seed('users', SEED_U)
                    assert.strict.deepStrictEqual(await w.insertBulk([{ id: v, name: 'ib' }]), { n: 1, nInserted: 1, ok: 1 })
                }
            })

            it('Jet視為相異而JS可折疊者(ı與I、ſ與S、①與1、Kelvin符號與K、ẞ與ß)不得誤命中或誤刪(R-PK-05)', async function() {
                //修正初版以JS近似鍵比對, 多判即令select/delAll命中Jet視為相異之列而誤刪; 以下各對皆經Jet實測為相異
                let w = ws.users
                let pairs = [['I', 'ı'], ['S', 'ſ'], ['1', '①'], ['K', 'K'], ['ß', 'ẞ'], ['IV', 'Ⅳ'], ['kg', '㎏']]
                for (let [stored, v] of pairs) {
                    await seed('users', [{ id: stored, name: 'keep' }, { id: 'zz', name: 'other' }])
                    assert.strict.strictEqual(await w.selectByPk(v), null, `${v}: Jet相異`)
                    assert.strict.deepStrictEqual(await w.select({ id: v }), [], `${v}: select不得命中${stored}`)
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 0, nDeleted: 0, ok: 1 }, `${v}: delAll不得刪除${stored}`)
                    assert.strict.deepStrictEqual((await ids('users')).sort(), [stored, 'zz'].sort())
                    assert.strict.deepStrictEqual(await w.delAll({ id: { $ne: v } }), { n: 2, nDeleted: 2, ok: 1 }, `${v}: $ne須刪除${stored}`)
                }
            })

            it('Jet視為同鍵而JS不易仿製者(忽略增補平面字元)於select、delAll與selectByPk、del一致(R-PK-05)', async function() {
                //Jet忽略增補平面字元(如表情符號): 'a😀'≡'a'、'😀'≡'😁'(已實測); 近似鍵少判時$ne會把Jet視為同鍵之列刪除
                let w = ws.users
                for (let [stored, v] of [['a', 'a😀'], ['😀', '😁']]) {
                    await seed('users', [{ id: stored, name: 'keep' }, { id: 'zz', name: 'other' }])
                    let a = await w.selectByPk(v)
                    assert.strict.ok(a !== null && a.id === stored, `${v}: selectByPk命中${stored}`)
                    assert.strict.deepStrictEqual(await w.select({ id: v }), [a], `${v}: select({主鍵})[0]與selectByPk相同(:260)`)
                    assert.strict.deepStrictEqual(await w.delAll({ id: { $ne: v } }), { n: 1, nDeleted: 1, ok: 1 }, `${v}: $ne不得刪除${stored}`)
                    assert.strict.deepStrictEqual(await ids('users'), [stored])
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 1, nDeleted: 1, ok: 1 })
                    assert.strict.deepStrictEqual(await all('users'), [])
                }
            })

            it('非運算子物件(空運算子物件)作為主鍵條件值: select與delAll皆reject、不刪除(不得清空全表; 1.0.36 為無效值而不命中)', async function() {
                //第33項批2: 空運算子物件在系列白名單外, 整批reject
                let w = ws.users
                await seed('users', SEED_U)
                assert.strict.strictEqual(await getRt(w.select({ id: {} })), 'reject')
                assert.strict.strictEqual(await getRt(w.delAll({ id: {} })), 'reject')
                assert.strict.strictEqual((await all('users')).length, SEED_U.length, '不得刪除任何列')
                let wi = ws.ipk
                await seed('ipk', [{ id: 12, name: 'r12' }])
                assert.strict.strictEqual(await getRt(wi.delAll({ id: {} })), 'reject')
                assert.strict.strictEqual((await all('ipk')).length, 1)
            })

        })

        describe('同批變體重複與撞他唯一索引(R-PK-04)', function() {

            it('同批以Jet等值變體重複時僅首筆計入nInserted(:280)', async function() {
                let w = ws.users
                await seed('users', [])
                assert.strict.deepStrictEqual(await w.insert([{ id: 'k9', name: 'first' }, { id: 'K9 ', name: 'second' }]), { n: 2, nInserted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await w.insert([{ id: 'B1', name: 'first' }, { id: 'Ｂ１', name: 'second' }]), { n: 2, nInserted: 1, ok: 1 })
                assert.strict.deepStrictEqual((await all('users')).map((r) => r.name), ['first', 'first'])
            })

            it('撞及主鍵以外之唯一索引仍為整批reject(踩坑紀錄第2條)', async function() {
                let w = ws.uqx
                await seed('uqx', [{ id: 'k2', code: 'C1', name: 'r' }])
                //新主鍵撞code唯一索引, 不得視為已存在而跳過
                assert.strict.strictEqual(await getRt(w.insert([{ id: 'new', code: 'C1', name: 'x' }])), 'reject')
                //主鍵之Jet等值變體則為已存在而跳過
                assert.strict.deepStrictEqual(await w.insert([{ id: 'K2 ', code: 'C2', name: 'x' }]), { n: 1, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await ids('uqx'), ['k2'])
            })

        })

        describe('字串主鍵之數字(R-PK-02、03; Q1)', function() {

            it('有限數字以String(v)處置, 七函數一致且表非空時亦同', async function() {
                let w = ws.users
                await seed('users', SEED_U)
                assert.strict.deepStrictEqual(await w.insert([{ id: 123, name: 'n123' }]), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.ok((await ids('users')).includes('123'), '存值為字串123')
                let r = await w.selectByPk(123)
                assert.strict.ok(r !== null && r.id === '123', 'selectByPk(123)須回該列而非reject(:262、:265)')
                assert.strict.deepStrictEqual(await w.insert([{ id: 123, name: 'again' }]), { n: 1, nInserted: 0, ok: 1 }, '再insert須跳過而非reject(:279)')
                assert.strict.deepStrictEqual(await w.insert([{ id: '123', name: 'again' }]), { n: 1, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.save([{ id: 123, name: 'sv' }]), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                assert.strict.strictEqual((await w.select({ id: 123 })).length, 1)
                assert.strict.strictEqual(await w.selectByPk(456), null, '表內無者回null不reject(:262)')
                assert.strict.deepStrictEqual(await w.del([{ id: 123 }]), [{ n: 1, nDeleted: 1, ok: 1 }])
                assert.strict.ok(!(await ids('users')).includes('123'))
            })

            it('數字0與指數形式數字', async function() {
                let w = ws.users
                await seed('users', SEED_U)
                assert.strict.deepStrictEqual(await w.insert([{ id: 0 }]), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.strictEqual((await w.selectByPk(0)).id, '0')
                assert.strict.deepStrictEqual(await w.insert([{ id: 1e21 }]), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.ok((await ids('users')).includes('1e+21'), '存值為String(1e21)')
                assert.strict.strictEqual((await w.selectByPk(1e21)).id, '1e+21')
                assert.strict.deepStrictEqual(await w.delAll({ id: 0 }), { n: 1, nDeleted: 1, ok: 1 })
            })

        })

        describe('數值主鍵欄(R-PK-02、03; Q2、Q5)', function() {

            it('整數主鍵: 12與標準數字字串"12"於七函數一致', async function() {
                let w = ws.ipk
                for (let v of [12, '12']) {
                    await seed('ipk', [{ id: 12, name: 'r12' }, { id: 5, name: 'r5' }])
                    assert.strict.strictEqual((await w.selectByPk(v)).id, 12)
                    assert.strict.strictEqual((await w.select({ id: v })).length, 1)
                    assert.strict.deepStrictEqual(await w.insert([{ id: v, name: 'x' }]), { n: 1, nInserted: 0, ok: 1 })
                    assert.strict.deepStrictEqual(await w.save([{ id: v, name: 'sv' }]), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                    assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 1, nDeleted: 1, ok: 1 }])
                }
            })

            it('整數主鍵之型別不符: selectByPk回null、寫入前reject、del該筆ok為0、select不命中', async function() {
                let w = ws.ipk
                for (let v of ['012', 12.4, 'abc']) {
                    await seed('ipk', [{ id: 12, name: 'r12' }, { id: 5, name: 'r5' }])
                    assert.strict.strictEqual(await w.selectByPk(v), null, `${v}: 型別不符回null不reject(:262)`)
                    assert.strict.strictEqual(await getRt(w.insert([{ id: 7, name: 'ok' }, { id: v, name: 'x' }])), 'reject')
                    assert.strict.strictEqual(await getRt(w.insertBulk([{ id: v, name: 'x' }])), 'reject')
                    assert.strict.strictEqual(await getRt(w.save([{ id: 8, name: 'ok' }, { id: v, name: 'x' }])), 'reject')
                    assert.strict.deepStrictEqual((await ids('ipk')).sort(), [12, 5].sort(), `${v}: 寫入前即reject, 同批有效列亦不得寫入`)
                    let rd = await w.del([{ id: v }])
                    assert.strict.strictEqual(rd[0].ok, 0)
                    assert.strict.ok(typeof rd[0].err === 'string' && rd[0].err.length > 0)
                    assert.strict.deepStrictEqual(await w.select({ id: v }), [])
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 0, nDeleted: 0, ok: 1 })
                    assert.strict.strictEqual((await all('ipk')).length, 2)
                }
            })

            it('浮點主鍵: 0.1與"0.1"於七函數一致', async function() {
                let w = ws.dpk
                for (let v of [0.1, '0.1']) {
                    await seed('dpk', [{ id: 0.1, name: 'r' }, { id: 7, name: 'r7' }])
                    assert.strict.strictEqual((await w.selectByPk(v)).id, 0.1)
                    assert.strict.deepStrictEqual((await w.select({ id: v })).map((r) => r.id), [0.1])
                    assert.strict.deepStrictEqual(await w.insert([{ id: v }]), { n: 1, nInserted: 0, ok: 1 })
                    assert.strict.strictEqual(await getRt(w.insertBulk([{ id: v }])), 'reject')
                    assert.strict.deepStrictEqual(await w.save([{ id: v, name: 'sv' }]), [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                    assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 1, nDeleted: 1, ok: 1 }])
                    await seed('dpk', [{ id: 0.1, name: 'r' }, { id: 7, name: 'r7' }])
                    assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 1, nDeleted: 1, ok: 1 })
                    assert.strict.deepStrictEqual(await ids('dpk'), [7])
                }
            })

        })

        describe('不可能存在之主鍵(R-PK-02、03)', function() {

            it('超過255字元: 不命中他列、不誤刪他列、寫入前reject', async function() {
                let w = ws.users
                let v = S255 + 'y'
                await seed('users', [{ id: S255, name: 'x255' }, { id: 'k2', name: 'k2row' }])
                assert.strict.strictEqual(await w.selectByPk(v), null, '不得回傳以其前255字元為鍵之他列')
                assert.strict.deepStrictEqual(await w.select({ id: v }), [])
                assert.strict.deepStrictEqual(await w.select({ id: { $in: [v] } }), [])
                assert.strict.deepStrictEqual(await w.delAll({ id: v }), { n: 0, nDeleted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 0, nDeleted: 0, ok: 1 }])
                assert.strict.ok((await ids('users')).includes(S255), '不得誤刪他列')
                let rs1 = await w.save([{ id: v, name: 'z' }])
                assert.strict.strictEqual(rs1[0].ok, 0)
                assert.strict.ok(typeof rs1[0].err === 'string' && rs1[0].err.length > 0)
                let rs2 = await w.save([{ id: v }])
                assert.strict.strictEqual(rs2[0].ok, 0, '只帶主鍵亦不得回報命中')
                assert.strict.deepStrictEqual(await w.save([{ id: v }], { autoInsert: false }), [{ n: 0, nInserted: 0, nModified: 0, ok: 1 }])
                assert.strict.strictEqual(await getRt(w.insert([{ id: 'ok-1' }, { id: v }])), 'reject')
                assert.strict.strictEqual(await getRt(w.insertBulk([{ id: 'ok-2' }, { id: v }])), 'reject')
                let after = await all('users')
                assert.strict.deepStrictEqual(after.map((r) => r.id).sort(), [S255, 'k2'].sort(), '同批有效列亦不得寫入')
                assert.strict.strictEqual(after.find((r) => r.id === S255).name, 'x255', '他列不得被改寫')
            })

            it('含NUL與孤立代理', async function() {
                let w = ws.users
                await seed('users', [{ id: 'k2', name: 'k2row' }])
                for (let v of ['k\u00002', 's\uD800']) {
                    assert.strict.strictEqual(await w.selectByPk(v), null)
                    assert.strict.deepStrictEqual(await w.del([{ id: v }]), [{ n: 0, nDeleted: 0, ok: 1 }])
                    assert.strict.strictEqual(await getRt(w.select({ id: v })), 'reject', '條件值含NUL或孤立代理: 白名單拒收(1.0.36 為不命中)')
                    assert.strict.strictEqual(await getRt(w.delAll({ id: v })), 'reject')
                    assert.strict.strictEqual(await getRt(w.insert([{ id: 'ok-1' }, { id: v }])), 'reject')
                    assert.strict.deepStrictEqual(await ids('users'), ['k2'])
                }
            })

        })

        describe('model邊界與內部欄名(R-PK-02、05)', function() {

            //writeModel, 於暫存資料夾寫入僅供本案使用之model
            function writeModel(fd, cl, cols) {
                fs.mkdirSync(fd, { recursive: true })
                let body = cols.map(([k, t, pk]) => `'${k}': {\ntype: DataTypes.${t},\nallowNull: ${pk ? 'false' : 'true'},\n${pk ? 'primaryKey: true,\n' : ''}comment: null\n}`).join(',\n')
                fs.writeFileSync(path.join(fd, `${cl}.js`), `module.exports = function(sequelize, DataTypes) {\nreturn sequelize.define('${cl}', {\n${body}\n}, {\ntableName: '${cl}'\n});\n};\n`, 'utf8')
            }

            it('model未定義主鍵欄(型別無從得知)時, 超過255字元之主鍵仍不得命中或刪除他列', async function() {
                let fd = `${fdTmp}/models-nopkcol`
                writeModel(fd, 'ukey', [['name', 'TEXT']])
                let w = mk('ukey', { pk: 'uid', fdModels: fd })
                await seed('ukey', [{ uid: S255, id: 'x', name: 'x255' }, { uid: 'k2', id: 'y', name: 'k2row' }])
                assert.strict.strictEqual(await w.selectByPk(S255 + 'y'), null)
                assert.strict.deepStrictEqual(await w.del([{ uid: S255 + 'y' }]), [{ n: 0, nDeleted: 0, ok: 1 }])
                assert.strict.deepStrictEqual((await ids('ukey', 'uid')).sort(), [S255, 'k2'].sort(), '不得誤刪他列')
            })

            it('使用者之欄位與條件即使與內部欄名前綴同名, 亦依其本身之值比對且條件不被覆寫', async function() {
                let fd = `${fdTmp}/models-wcol`
                writeModel(fd, 'wcol', [['id', 'STRING', true], ['__worm_wi', 'INTEGER'], ['__worm_wk', 'STRING']])
                await jet.execute('CREATE TABLE [wcol] ([id] TEXT(255) CONSTRAINT [pk] PRIMARY KEY, [__worm_wi] LONG, [__worm_wk] TEXT(255))').catch(() => {})
                let w = mk('wcol', { fdModels: fd })
                let SEED = [{ id: 'k2', __worm_wi: 99, __worm_wk: 'kk3' }, { id: 'k3', __worm_wi: 0, __worm_wk: 'x' }]
                await seed('wcol', SEED)
                assert.strict.deepStrictEqual((await w.select({ id: 'k2', __worm_wk: 'kk3' })).map((r) => r.id), ['k2'])
                assert.strict.deepStrictEqual(await w.select({ id: 'k3', __worm_wk: 'kk3' }), [])
                assert.strict.deepStrictEqual(await w.delAll({ __worm_wi: 0 }), { n: 1, nDeleted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await ids('wcol'), ['k2'], '只刪除__worm_wi為0之k3')
            })

            it('已知限制L3: 存值主鍵為空字串之列被delAll命中時整批reject且不刪除任何列', async function() {
                let w = ws.users
                await seed('users', [{ id: '', name: 'emptyrow' }, { id: 'k2', name: 'k2row' }])
                assert.strict.strictEqual(await getRt(w.delAll({ name: 'emptyrow' })), 'reject')
                assert.strict.strictEqual((await all('users')).length, 2)
            })

            it('僅因尾端半形空白而超過255字元者非不可能存在, 依Jet視同去除尾端空白者', async function() {
                let w = ws.users
                await seed('users', [{ id: S255, name: 'x255' }])
                let v = S255 + ' '
                assert.strict.strictEqual((await w.selectByPk(v)).id, S255)
                assert.strict.deepStrictEqual((await w.select({ id: v })).map((r) => r.id), [S255])
                assert.strict.deepStrictEqual(await w.insert([{ id: v }]), { n: 1, nInserted: 0, ok: 1 })
            })

            it('CURRENCY主鍵以精度外之值操作時, select、delAll與selectByPk、del之命中一致', async function() {
                //Jet之SELECT/DELETE會把常值轉為欄之精度再比對(1.23456命中存值1.2346), select須由Jet判定而非記憶體比對存值
                let fd = `${fdTmp}/models-cpk`
                writeModel(fd, 'cpk', [['id', 'DECIMAL', true], ['name', 'TEXT']])
                await jet.execute('CREATE TABLE [cpk] ([id] CURRENCY CONSTRAINT [pk] PRIMARY KEY, [name] TEXT(255))').catch(() => {})
                let w = mk('cpk', { fdModels: fd })
                await seed('cpk', [{ id: 1.2346, name: 'c' }, { id: 7, name: 'c7' }])
                let a = await w.selectByPk(1.23456)
                assert.strict.ok(a !== null && a.id === 1.2346, 'selectByPk命中捨入後之存值')
                assert.strict.deepStrictEqual(await w.select({ id: 1.23456 }), [a])
                assert.strict.deepStrictEqual(await w.insert([{ id: 1.23456 }]), { n: 1, nInserted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.delAll({ id: { $ne: 1.23456 } }), { n: 1, nDeleted: 1, ok: 1 }, '$ne不得刪除Jet視為同鍵之列')
                assert.strict.deepStrictEqual(await ids('cpk'), [1.2346])
            })

            it('opt.pk欄於model未標主鍵時由importModels補標, 且只改該欄(R-PK-07)', async function() {
                let fd = `${fdTmp}/models-ukey2`
                writeModel(fd, 'ukey', [['uid', 'STRING'], ['id', 'STRING'], ['name', 'TEXT']])
                let fpModel = path.join(fd, 'ukey.js')
                let w = mk('ukey', { pk: 'uid', fdModels: fd })
                await seed('ukey', [{ uid: 'k2', id: 'x', name: 'r' }])
                assert.strict.strictEqual((await w.selectByPk('K2')).uid, 'k2')
                let h = fs.readFileSync(fpModel, 'utf8')
                assert.strict.ok(h.indexOf(`'uid': {primaryKey: true,`) >= 0, 'uid須被補標主鍵')
                assert.strict.ok(h.indexOf(`'id': {primaryKey: true,`) < 0, 'id不得被補標主鍵')
            })

        })

        describe('無效值、包裝物件與BigInt(R-PK-02、03; Q6)', function() {

            it('±Infinity: selectByPk回null、del該筆ok為0、insert依T6補值或reject、select不命中', async function() {
                let w = ws.users
                await seed('users', SEED_U)
                assert.strict.strictEqual(await w.selectByPk(Infinity), null)
                let rd = await w.del([{ id: Infinity }])
                assert.strict.strictEqual(rd[0].ok, 0, '無效主鍵為該筆失敗(:114)')
                assert.strict.strictEqual(await getRt(w.select({ id: Infinity })), 'reject', '條件值±Infinity: 白名單拒收(1.0.36 為不命中)')
                assert.strict.strictEqual(await getRt(w.delAll({ id: -Infinity })), 'reject')
                assert.strict.strictEqual((await all('users')).length, SEED_U.length, '不得刪除任何列')
                assert.strict.deepStrictEqual(await w.insert([{ id: Infinity, name: 'inf' }]), { n: 1, nInserted: 1, ok: 1 })
                let row = (await all('users')).find((r) => r.name === 'inf')
                assert.strict.ok(row && row.id.length === 36, '依T6補值(:91)')
                let wf = mk('users', { autoGenPk: false })
                assert.strict.strictEqual(await getRt(wf.insert([{ id: Infinity }])), 'reject', 'autoGenPk為false時reject(:100)')
            })

            it('包裝物件拆包、new String("")與new Number(NaN)為無效', async function() {
                let w = ws.users
                await seed('users', [...SEED_U, { id: '123', name: 'n123' }, { id: 'NaN', name: 'nanrow' }])
                assert.strict.strictEqual((await w.selectByPk(new String('k2'))).id, 'k2')
                assert.strict.strictEqual(await getRt(w.select({ id: new Number(123) })), 'reject', '條件值為包裝物件: 白名單拒收(1.0.36 拆包後命中; selectByPk與資料列仍拆包)')
                assert.strict.strictEqual(await w.selectByPk(new Number(NaN)), null, '不得命中NaN字串之列')
                assert.strict.strictEqual(await w.selectByPk(new String('')), null)
                assert.strict.strictEqual((await w.del([{ id: new String('') }]))[0].ok, 0)
                await w.insert([{ id: new String(''), name: 'empty' }])
                let row = (await all('users')).find((r) => r.name === 'empty')
                assert.strict.ok(row && row.id.length === 36, '不得寫出空字串主鍵, 依T6補值')
                await seed('users', [{ id: '12', name: 'n12' }])
                assert.strict.strictEqual((await w.selectByPk(new Number(12))).id, '12', '拆包後同數字12, 依String(v)命中')
                let wi = ws.ipk
                await seed('ipk', [{ id: 12, name: 'r12' }])
                assert.strict.strictEqual((await wi.selectByPk(new Number(12))).id, 12)
            })

            it('BigInt為無效: select/delAll皆reject(1.0.36 為不命中)且不刪除', async function() {
                let w = ws.users
                await seed('users', [...SEED_U, { id: '123', name: 'n123' }])
                assert.strict.strictEqual(await getRt(w.select({ id: 123n })), 'reject')
                assert.strict.strictEqual(await getRt(w.delAll({ id: 123n })), 'reject')
                assert.strict.ok((await ids('users')).includes('123'), '不得刪除123')
                assert.strict.strictEqual(await w.selectByPk(123n), null)
                assert.strict.strictEqual((await w.del([{ id: 123n }]))[0].ok, 0)
            })

        })

        describe('否定與等值運算子(R-PK-05)', function() {

            it('$ne與$nin不刪除Jet視為同鍵之列, $eq與$in命中', async function() {
                let w = ws.users
                await seed('users', [{ id: 'k2', name: 'a' }, { id: 'A1', name: 'b' }, { id: 'abc', name: 'c' }])
                assert.strict.deepStrictEqual((await w.select({ id: { $eq: 'K2 ' } })).map((r) => r.id), ['k2'])
                assert.strict.strictEqual(await getRt(w.select({ id: ['K2 '] })), 'reject', '陣列值已移除(1.0.36 即$in)')
                assert.strict.deepStrictEqual((await w.select({ id: { $in: ['K2 '] } })).map((r) => r.id), ['k2'])
                assert.strict.deepStrictEqual((await w.select({ id: { $nin: ['Ａ１', 'K2 '] } })).map((r) => r.id), ['abc'])
                assert.strict.deepStrictEqual(await w.delAll({ id: { $ne: 'K2 ' } }), { n: 2, nDeleted: 2, ok: 1 })
                assert.strict.deepStrictEqual(await ids('users'), ['k2'], 'k2不得被刪除')
            })

            it('主鍵欄$not與頂層$not已移除(reject); 白名單內之$ne依Jet等值排除, $in之值須為陣列', async function() {
                //範圍運算子($gt等)依記憶體sqlite比較而為近似, 屬已知限制(CLAUDE_rulebook.md之L2), 不在此斷言
                let w = ws.users
                let SEED = [{ id: 'k2', name: 'a' }, { id: 'A1', name: 'b' }, { id: 'abc', name: 'c' }]
                await seed('users', SEED)
                for (let find of [{ id: { $not: 'K2 ' } }, { $not: { id: 'K2 ' } }, { id: { $not: { $eq: 'K2 ' } } }]) {
                    assert.strict.strictEqual(await getRt(w.select(find)), 'reject', JSON.stringify(find))
                    assert.strict.strictEqual(await getRt(w.delAll(find)), 'reject', JSON.stringify(find))
                }
                assert.strict.deepStrictEqual((await ids('users')).sort(), ['A1', 'abc', 'k2'].sort(), 'reject不得刪除任何列')
                assert.strict.strictEqual(await getRt(w.select({ id: { $in: 'K2 ' } })), 'reject', '$in純量已移除(1.0.36 視為單元素陣列)')
                assert.strict.deepStrictEqual((await w.select({ id: { $ne: 'K2 ' } })).map((r) => r.id).sort(), ['A1', 'abc'].sort())
                assert.strict.deepStrictEqual(await w.delAll({ id: { $ne: 'K2 ' } }), { n: 2, nDeleted: 2, ok: 1 })
                assert.strict.deepStrictEqual(await ids('users'), ['k2'], '$ne不得刪除k2')
            })

            it('否定語境之無效主鍵值一律reject且不刪除任何列(不得因無效值推得全部命中而清空全表)', async function() {
                let w = ws.users
                let SEED = [{ id: 'k2', name: 'a' }, { id: 'A1', name: 'b' }]
                await seed('users', SEED)
                //白名單檢核先拒者(undefined、BigInt、NaN 等非白名單純量, 及已移除之 $not): 1.0.36 在此亦 reject 或不命中, 第33項批2 一律於形狀層 reject
                for (let find of [{ id: { $ne: undefined } }, { id: { $ne: 123n } }, { id: { $nin: ['k2', undefined] } }, { $not: { id: undefined } }, { id: { $not: null } }]) {
                    assert.strict.strictEqual(await getRt(w.delAll(find)), 'reject', JSON.stringify(find, (k, v) => typeof v === 'bigint' ? `${v}n` : v))
                    assert.strict.strictEqual(await getRt(w.select(find)), 'reject')
                }
                //通過形狀檢核而為無效主鍵值(null、布林、Date、空字串)於否定語境: castPkFind 拋出(R-PK-03 4b; LW2)
                for (let find of [{ id: { $ne: null } }, { id: { $ne: true } }, { id: { $ne: new Date(0) } }, { id: { $ne: '' } }, { id: { $nin: ['k2', ''] } }]) {
                    assert.strict.strictEqual(await getRt(w.delAll(find)), 'reject', JSON.stringify(find))
                    assert.strict.strictEqual(await getRt(w.select(find)), 'reject')
                }
                assert.strict.strictEqual((await all('users')).length, SEED.length, '不得刪除任何列')
                //肯定語境之無效值為不命中(undefined 於形狀層 reject; null、空字串、布林、Date 通過形狀檢核而不命中)
                assert.strict.strictEqual(await getRt(w.delAll({ id: undefined })), 'reject')
                assert.strict.deepStrictEqual(await w.delAll({ id: null }), { n: 0, nDeleted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.delAll({ id: { $in: ['', 'zz'] } }), { n: 0, nDeleted: 0, ok: 1 })
                assert.strict.deepStrictEqual(await w.delAll({ id: true }), { n: 0, nDeleted: 0, ok: 1 })
                assert.strict.strictEqual((await all('users')).length, SEED.length)
            })

        })

        describe('長字串主鍵(R-PK-04、06)', function() {

            it('255個é之主鍵: delAll以主鍵條件命中者實際刪除(R-PK-06)', async function() {
                let w = ws.users
                await seed('users', [{ id: E255, name: 'long' }])
                assert.strict.strictEqual((await w.select({ id: E255 })).length, 1)
                assert.strict.deepStrictEqual(await w.delAll({ id: E255 }), { n: 1, nDeleted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await all('users'), [])
            })

            it('255個é之主鍵: delAll以非主鍵條件命中者亦實際刪除(R-PK-06)', async function() {
                let w = ws.users
                await seed('users', [{ id: E255, name: 'long' }])
                assert.strict.deepStrictEqual(await w.delAll({ name: 'long' }), { n: 1, nDeleted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await all('users'), [])
            })

            it('255個é之主鍵: insert撞鍵視為已存在而跳過(R-PK-04; :279、:280)', async function() {
                let w = ws.users
                await seed('users', [{ id: E255, name: 'long' }])
                assert.strict.deepStrictEqual(await w.insert([{ id: 'new1' }, { id: E255 }]), { n: 2, nInserted: 1, ok: 1 })
                assert.strict.deepStrictEqual((await ids('users')).sort(), [E255, 'new1'].sort())
            })

        })

        describe('UUID主鍵與select內容(R-PK-01、05)', function() {

            it('UUID型別主鍵之select與delAll不分大小寫, 與selectByPk一致', async function() {
                let w = ws.upk
                let id = '01a137de-c762-7638-95e0-2f09d6058132'
                await seed('upk', [{ id, name: 'u' }])
                let up = id.toUpperCase()
                assert.strict.deepStrictEqual(await w.select({ id: up }), [await w.selectByPk(up)])
                assert.strict.deepStrictEqual(await w.delAll({ id: up }), { n: 1, nDeleted: 1, ok: 1 })
            })

            it('DATE與BOOLEAN欄: selectByPk與select({主鍵})[0]、select()之該列內容相同(:260)', async function() {
                let w = ws.tt
                await seed('tt', [
                    { id: 'r1', fDate: new Date(2026, 9, 14, 8, 30, 15), fBool: true, fDec: 12.34, fInt: 7, fDbl: 0.1, fStr: 'a b ', fText: 'long\ntext' },
                    { id: 'r2', fDate: null, fBool: false, fDec: 0, fInt: -1, fDbl: -2.5, fStr: '', fText: '' },
                ])
                for (let id of ['r1', 'r2']) {
                    let a = await w.selectByPk(id)
                    assert.strict.deepStrictEqual((await w.select({ id }))[0], a)
                    assert.strict.deepStrictEqual((await w.select()).find((r) => r.id === id), a)
                }
            })

        })

        describe('事件(T10)', function() {

            it('change事件之data主鍵為正規化值; 型別不符於reject前發出error', async function() {
                let w = mk('users')
                let evs = []
                w.on('change', (mode, data) => {
                    evs.push(['change', mode, data])
                })
                await seed('users', [])
                await w.insert([{ id: 321, name: 'n' }])
                let e = evs.find((x) => x[1] === 'insert')
                assert.strict.strictEqual(e[2][0].id, '321')
                let wi = mk('ipk')
                let errs = []
                wi.on('error', (mode, data, err) => {
                    errs.push([mode, err])
                })
                assert.strict.strictEqual(await getRt(wi.insert([{ id: 'abc' }])), 'reject')
                assert.strict.strictEqual(errs.length, 1)
                assert.strict.strictEqual(errs[0][0], 'insert')
                assert.strict.strictEqual(typeof errs[0][1], 'string')
            })

        })

        describe('opt.pk非id(R-PK-07)', function() {

            it('opt.pk為uid而model另有非主鍵欄id: 正常運作且不改寫model檔', async function() {
                let fpModel = path.join(fdModels, 'ukey.js')
                let h0 = fs.readFileSync(fpModel, 'utf8')
                let w = mk('ukey', { pk: 'uid' })
                await seed('ukey', [{ uid: 'k2', id: 'x', name: 'r' }])
                assert.strict.strictEqual((await w.select({ uid: 'K2' })).length, 1)
                assert.strict.strictEqual((await w.selectByPk('K2 ')).uid, 'k2')
                assert.strict.deepStrictEqual(await w.delAll({ uid: 'K2' }), { n: 1, nDeleted: 1, ok: 1 })
                assert.strict.strictEqual(fs.readFileSync(fpModel, 'utf8'), h0, 'model檔不得被改寫')
            })

        })

    })
}
