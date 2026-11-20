import assert from 'assert'
import { isWindows } from './unit-setup.mjs'
import { seedsStr, shapesMore, entries, expectStr, observe, chkObs, initCtx, mask, GetA, MSG_NOPK_OFF, MSG_DEL } from './unit-pkown-setup.mjs'


//spec: sgud/rule/rulebook_pk.md 之 R-PKOWN-01(第569項; 共用層 unit-pkown-setup.mjs 載明 P1~P5)
//本檔: 其餘列形狀、P2 讀取次數與拋錯、同批多筆(逐筆判定)、P4 selectByPk、P5 非主鍵欄不變、opt.pk非id、呼叫端原物件不被改動、事件


const nm = 'pkown3'


if (isWindows()) {
    describe('WOrmMdb pkown3(R-PKOWN-01; 其餘形狀、讀取次數、同批、selectByPk、非主鍵欄、opt.pk、原物件)', function() {

        let ctx = null
        let on = null
        let off = null

        before(async function() {
            ctx = await initCtx(nm)
            on = ctx.mkW('users', { autoGenPk: true })
            off = ctx.mkW('users', { autoGenPk: false })
        })

        after(function() {
            ctx.cleanup()
        })


        describe('其餘列形狀 × insert/save/del × 同值列', function() {
            for (let autoGenPk of [true, false]) {
                for (let sh of shapesMore) {
                    for (let sn of Object.keys(seedsStr)) {
                        for (let en of entries.filter((e) => ['insert', 'save', 'del'].includes(e.mode) && e.nm !== 'insert(row)')) {
                            it(`autoGenPk:${autoGenPk} × ${sh.nm} × ${en.nm} × 同值列:${sn}`, async function() {
                                await ctx.seed('users', seedsStr[sn])
                                let obs = await observe(sh, en, autoGenPk ? on.w : off.w)
                                let db = await ctx.dump('users')
                                chkObs(obs, expectStr(sh, en, autoGenPk, sn), db, `users|autoGenPk:${autoGenPk}|${en.nm}|${sh.nm}|同值列:${sn}`)
                            })
                        }
                    }
                }
            }
        })


        describe('P2 判定不得多讀有效輸入: 先以既有路徑取值, 值為未帶即短路, 只有[給了]才查描述子', function() {

            //getter各讀一次(同修改前: 自有存取器於複製時讀一次, 繼承之存取器於攤平時讀一次, 其後皆為資料屬性)
            //mkGetRow, 類別實例之列: 原型上之類別getter id, 每讀一次c.n加1, 回傳fn()之值(fn可拋錯)
            let mkGetRow = (c, fn) => {
                class R {
                    get id() {
                        c.n++
                        return fn()
                    }
                }
                return Object.assign(new R(), { name: 'n' })
            }
            let mkCnt = {
                '自有存取器(有效)': (c) => Object.defineProperty({ name: 'n' }, 'id', {
                    get() {
                        c.n++
                        return 'r1'
                    },
                    enumerable: true,
                    configurable: true,
                }),
                '繼承類別getter(有效值)': (c) => mkGetRow(c, () => 'r2'),
                '繼承類別getter(拋錯)': (c) => mkGetRow(c, () => {
                    throw new Error('boom')
                }),
                '繼承類別getter(回undefined)': (c) => mkGetRow(c, () => undefined),
                '繼承類別getter(回空字串)': (c) => mkGetRow(c, () => ''),
            }
            let calls = {
                insert: (w, r) => w.insert([r]),
                save: (w, r) => w.save([r]),
                del: (w, r) => w.del([r]),
            }

            for (let autoGenPk of [true, false]) {
                for (let [cn, mk] of Object.entries(mkCnt)) {
                    for (let [en, call] of Object.entries(calls)) {
                        it(`autoGenPk:${autoGenPk} × ${cn} × ${en}: getter恰讀一次`, async function() {
                            await ctx.seed('users', [{ id: 'z0', name: 'z' }])
                            let ctxw = autoGenPk ? on : off
                            ctxw.evs.error.length = 0
                            let c = { n: 0 }
                            let rej = null
                            let res = null
                            try {
                                res = await call(ctxw.w, mk(c))
                            }
                            catch (err) {
                                rej = mask(err && err.message)
                            }
                            let db = await ctx.dump('users')

                            //P2 讀取次數: 與修改前相同(有效輸入不因判定而多讀, 值為未帶者短路不查描述子)
                            assert.strict.strictEqual(c.n, 1, `${cn} ${en}`)

                            if (cn === '繼承類別getter(拋錯)') {
                                //取值拋錯照既有路徑: 原樣經診斷出口reject(error事件恰一次), 不因主鍵改判為未帶而成功, 資料庫不變
                                assert.strict.strictEqual(rej, 'boom', `${cn} ${en}`)
                                assert.strict.strictEqual(ctxw.evs.error.length, 1)
                                assert.strict.deepStrictEqual(db, ['z0=z'])
                                return
                            }
                            if (cn === '自有存取器(有效)') {
                                //自有可列舉(複製時已讀為資料屬性): 以其值為主鍵
                                if (en === 'del') {
                                    assert.strict.deepStrictEqual(res.map((v) => [v.ok, v.nDeleted]), [[1, 0]])
                                    assert.strict.deepStrictEqual(db, ['z0=z'])
                                }
                                else {
                                    assert.strict.strictEqual(rej, null)
                                    assert.strict.deepStrictEqual(db, ['r1=n', 'z0=z'])
                                }
                                return
                            }
                            //繼承之getter(有效值、undefined、空字串)皆為未帶(P1): del該筆ok為0; 寫入依autoGenPk補新主鍵或整批reject
                            if (en === 'del') {
                                assert.strict.deepStrictEqual(res, [{ n: 0, ok: 0, nDeleted: 0, err: MSG_DEL }])
                                assert.strict.deepStrictEqual(db, ['z0=z'])
                            }
                            else if (autoGenPk) {
                                assert.strict.strictEqual(rej, null)
                                assert.strict.deepStrictEqual(db, ['<uuid>=n', 'z0=z'], '補新主鍵, 不以getter之值為主鍵')
                            }
                            else {
                                assert.strict.strictEqual(rej, MSG_NOPK_OFF)
                                assert.strict.deepStrictEqual(db, ['z0=z'])
                            }
                        })
                    }
                }
            }

        })


        describe('同批多筆: 逐筆判定, 繼承者視為未帶而不影響同批其餘筆', function() {

            let inh = () => Object.assign(Object.create({ id: 'a9' }), { name: 'n' })
            let inhNum = () => Object.assign(Object.create({ id: 123 }), { name: 'n' })

            it('insertBulk(autoGenPk:true): 自有主鍵列、繼承列、無主鍵列各自處置, 同值列a9與123不變', async function() {
                await ctx.seed('users', seedsStr.has)
                let r = await on.w.insertBulk([{ id: 'k1', name: 'own' }, inh(), { name: 'plain' }])
                assert.strict.deepStrictEqual(r, { n: 3, nInserted: 3, ok: 1 })
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', '<uuid>=n', '<uuid>=plain', 'a9=seed', 'k1=own', 'z0=z'].sort())
            })

            it('insertBulk(autoGenPk:false): 繼承列使整批reject(以索引最小者), 同批之自有主鍵列亦不寫入', async function() {
                await ctx.seed('users', seedsStr.has)
                await assert.rejects(() => off.w.insertBulk([{ id: 'k1', name: 'own' }, inh()]), (err) => err.message === 'invalid data[1].id, autoGenPk is false')
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', 'a9=seed', 'z0=z'])
            })

            it('save: 自有a9列更新既有a9, 繼承a9列補新主鍵寫入(不再覆寫a9第二次)', async function() {
                await ctx.seed('users', seedsStr.has)
                let r = await on.w.save([{ id: 'a9', name: 'upd' }, inh(), inhNum()])
                assert.strict.deepStrictEqual(r.map((v) => [v.ok, v.nInserted, v.nModified]), [[1, 0, 1], [1, 1, 0], [1, 1, 0]])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', '<uuid>=n', '<uuid>=n', 'a9=upd', 'z0=z'].sort())
            })

            it('del: 自有a9列刪除既有a9, 繼承a9列與繼承123列各自ok為0附既有訊息(不刪123), 自有z0列刪除', async function() {
                await ctx.seed('users', seedsStr.has)
                let r = await on.w.del([{ id: 'a9' }, inh(), inhNum(), { id: 'z0' }])
                assert.strict.deepStrictEqual(r, [
                    { n: 1, nDeleted: 1, ok: 1 },
                    { n: 0, nDeleted: 0, ok: 0, err: 'invalid data[1].id' },
                    { n: 0, nDeleted: 0, ok: 0, err: 'invalid data[2].id' },
                    { n: 1, nDeleted: 1, ok: 1 },
                ])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123'])
            })

        })


        describe('遮蔽以defineProperty定義自有屬性, 不用賦值(原型之id為唯讀時嚴格模式賦值會拋TypeError)', function() {

            //唯讀之id只在呼叫之同步段存在: 複製、攤平與遮蔽皆在同步段完成(snap於呼叫當下執行), 其後於非同步階段不再有汙染, 避免Node內部對物件賦值id(如計時器)失敗
            it('Object.prototype之id唯讀: 純物件之列與類別實例之列皆照常視為未帶並補新主鍵', async function() {
                await ctx.seed('users', seedsStr.has)
                let w = ctx.mkW('users', { autoGenPk: true, useStable: false }).w
                let si = await w.init()
                Object.defineProperty(Object.prototype, 'id', { value: 'a9', enumerable: false, writable: false, configurable: true }) // eslint-disable-line no-extend-native
                let pm = null
                try {
                    pm = w.insertBulk([{ name: 'n' }, Object.assign(new (class Q {})(), { name: 'q' })], { instance: si })
                }
                finally {
                    delete Object.prototype.id
                }
                let r = await pm
                assert.strict.deepStrictEqual(r, { n: 2, nInserted: 2, ok: 1 })
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', '<uuid>=n', '<uuid>=q', 'a9=seed', 'z0=z'])
            })

        })


        describe('LPKOWN5 複本與呼叫端原物件不一致之極端形狀(釘住現況, 見R-PKOWN-03)', function() {

            //自有性依cloneDeep之複本判定(與參考實作w-orm-lowdb之isOwnPk同): cloneDeep以賦值複製自有屬性, 原型上之setter或唯讀屬性會影響複本
            class Acc {
                get id() {
                    return this._id
                }

                set id(v) {
                    this._id = v
                }
            }

            it('類別以get/set存取器對承載主鍵(實例無自有id): 視為未帶(規則明示之類別getter), 補新主鍵; 修前以存取器之值為主鍵', async function() {
                await ctx.seed('users', seedsStr.has)
                let r = new Acc()
                r.id = 'a9'
                r.name = 'n'
                await on.w.insert([r])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', '<uuid>=n', 'a9=seed', 'z0=z'])
            })

            it('自有可列舉之資料屬性id遮蔽帶setter之原型存取器: 複製時賦值落入setter, 複本無自有id, 視為未帶(極端形狀, 修前以own2寫入)', async function() {
                await ctx.seed('users', seedsStr.none)
                let r = new Acc()
                Object.defineProperty(r, 'id', { value: 'own2', enumerable: true, writable: true, configurable: true })
                r.name = 'n'
                await on.w.insert([r])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['<uuid>=n', 'z0=z'])
            })

            it('原型為frozen而列另有自有可列舉id: cloneDeep賦值拋TypeError, 以固定詞彙整批拒收(修前修後相同, 非靜默)', async function() {
                await ctx.seed('users', seedsStr.none)
                let r = Object.defineProperty(Object.create(Object.freeze({ id: 'a9' })), 'id', { value: 'own1', enumerable: true, writable: true, configurable: true })
                await assert.rejects(() => on.w.insert([r]), (err) => err.message === 'invalid data: must be a readable value')
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['z0=z'])
            })

            it('Map子類別之建構子建立自有預設id: 複本之id為自有而照用(修前修後相同)', async function() {
                await ctx.seed('users', seedsStr.none)
                class CtorDef extends Map {
                    constructor() {
                        super()
                        this.id = 'cons-default'
                    }
                }
                let r = new CtorDef()
                delete r.id
                r.name = 'n'
                await on.w.insert([r])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['cons-default=n', 'z0=z'])
            })

        })


        describe('P4 selectByPk收純量, 傳列物件回null(不適用繼承判定)', function() {

            it('傳入繼承id之列物件: 回null且不發error事件; 傳純量a9命中既有列', async function() {
                await ctx.seed('users', seedsStr.has)
                on.evs.error.length = 0
                assert.strict.strictEqual(await on.w.selectByPk(Object.assign(Object.create({ id: 'a9' }), { name: 'n' })), null)
                assert.strict.strictEqual(await on.w.selectByPk(new GetA()), null)
                assert.strict.strictEqual(on.evs.error.length, 0)
                let r = await on.w.selectByPk('a9')
                assert.strict.strictEqual(r.name, 'seed')
            })

        })


        describe('P5 非主鍵欄之繼承可列舉欄位與類別getter: 既有處置不變(照常寫入)', function() {

            it('自有主鍵 + 繼承之name: 寫入繼承值', async function() {
                await ctx.seed('users', seedsStr.none)
                await on.w.insert([Object.assign(Object.create({ name: 'inh' }), { id: 'k1' })])
                await on.w.save([Object.assign(Object.create({ name: 'inh2' }), { id: 'k2' })])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['k1=inh', 'k2=inh2', 'z0=z'])
            })

            it('自有主鍵 + 類別getter之name: 寫入getter值', async function() {
                await ctx.seed('users', seedsStr.none)
                class N {
                    get name() {
                        return 'g'
                    }
                }
                await on.w.insert([Object.assign(new N(), { id: 'k1' })])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['k1=g', 'z0=z'])
            })

            it('繼承之主鍵與繼承之name並存: 主鍵視為未帶(補新主鍵), name仍寫入繼承值', async function() {
                await ctx.seed('users', seedsStr.none)
                let row = Object.create({ id: 'a9', name: 'inh' })
                await on.w.insert([row])
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['<uuid>=inh', 'z0=z'])
            })

        })


        describe('opt.pk非id: 只對opt.pk之欄判定, 同名inherited之id欄(非主鍵)照舊', function() {

            //ukey表(worm_pk_def.mdb): 主鍵欄為uid(字串), 另有非主鍵之id欄與name欄; 只用名為uid之欄判定, id欄之繼承照舊
            let uk = null

            before(function() {
                uk = ctx.mkW('ukey', { pk: 'uid', autoGenPk: false })
            })

            async function seedUk(rows) {
                let cmds = [{ type: 'execute', sql: 'DELETE FROM [ukey]' }]
                for (let r of rows) {
                    cmds.push({ type: 'execute', sql: `INSERT INTO [ukey] ([uid],[id],[name]) VALUES ('${r.uid}', '${r.id}', '${r.name}')` })
                }
                await ctx.run(cmds)
            }

            async function dumpUk() {
                return (await ctx.query('SELECT * FROM [ukey]')).map((r) => `${r.uid}=${r.id}/${r.name}`).sort()
            }

            it('繼承之主鍵uid: insert/insertBulk/save整批reject, del該筆ok為0, 同值列u7不變', async function() {
                await seedUk([{ uid: 'u7', id: 'old', name: 'old-name' }])
                let mk = () => Object.assign(Object.create({ uid: 'u7' }), { id: 'x', name: 'n' })
                for (let api of ['insert', 'insertBulk', 'save']) {
                    await assert.rejects(() => uk.w[api]([mk()]), (err) => err.message === 'invalid data[0].uid, autoGenPk is false', api)
                }
                let r = await uk.w.del([mk()])
                assert.strict.deepStrictEqual(r, [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].uid' }])
                assert.strict.deepStrictEqual(await dumpUk(), ['u7=old/old-name'])
            })

            it('自有之主鍵uid + 繼承之id(非主鍵欄): 照常寫入繼承之id值(只對opt.pk之欄判定, 非寫死id)', async function() {
                await seedUk([])
                await uk.w.insert([Object.assign(Object.create({ id: 'inh' }), { uid: 'u8', name: 'n' })])
                assert.strict.deepStrictEqual(await dumpUk(), ['u8=inh/n'])
            })

        })


        describe('呼叫端原物件不被改動(只於複製後之列判定與遮蔽)', function() {

            it('繼承列與Object.prototype被定義id之列: 呼叫後自有屬性、原型與值皆不變', async function() {
                await ctx.seed('users', seedsStr.has)
                let proto = { id: 'a9' }
                let row = Object.assign(Object.create(proto), { name: 'n' })
                let plain = { name: 'n' }
                let before = [Object.getOwnPropertyNames(row), Object.getOwnPropertyNames(plain)]
                let si = await on.w.init()
                Object.defineProperty(Object.prototype, 'id', { value: 'a9', enumerable: false, writable: true, configurable: true }) // eslint-disable-line no-extend-native
                try {
                    await on.w.insert([row, plain], { instance: si })
                }
                finally {
                    delete Object.prototype.id
                }
                assert.strict.deepStrictEqual([Object.getOwnPropertyNames(row), Object.getOwnPropertyNames(plain)], before)
                assert.strict.strictEqual(Object.getPrototypeOf(row), proto)
                assert.strict.strictEqual(proto.id, 'a9')
                assert.strict.strictEqual(Object.prototype.hasOwnProperty.call(plain, 'id'), false)
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', '<uuid>=n', '<uuid>=n', 'a9=seed', 'z0=z'])
            })

        })


        describe('事件: 未帶(繼承)者之失敗與成功通道同未帶', function() {

            it('autoGenPk:false 繼承id列insert: error事件恰一次、不發change、資料庫不變', async function() {
                await ctx.seed('users', seedsStr.has)
                off.evs.error.length = 0
                off.evs.change.length = 0
                await assert.rejects(() => off.w.insert([Object.assign(Object.create({ id: 'a9' }), { name: 'n' })]), (err) => err.message === MSG_NOPK_OFF)
                assert.strict.strictEqual(off.evs.error.length, 1)
                assert.strict.strictEqual(off.evs.error[0].mode, 'insert')
                assert.strict.strictEqual(off.evs.change.length, 0)
                assert.strict.deepStrictEqual(await ctx.dump('users'), ['123=seed123', 'a9=seed', 'z0=z'])
            })

            it('autoGenPk:true 繼承id列insert: change事件之數據帶新產生之36碼主鍵(非繼承值)', async function() {
                await ctx.seed('users', seedsStr.has)
                let got = null
                let fn = (mode, data) => {
                    if (mode === 'insert') {
                        got = data
                    }
                }
                on.w.on('change', fn)
                await on.w.insert([Object.assign(Object.create({ id: 'a9' }), { name: 'n' })])
                assert.strict.ok(got !== null)
                assert.strict.strictEqual(got.length, 1)
                assert.strict.strictEqual(got[0].id.length, 36)
                assert.strict.notStrictEqual(got[0].id, 'a9')
            })

        })

    })
}
