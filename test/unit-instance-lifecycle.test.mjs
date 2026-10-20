import assert from 'assert'
import Sequelize from 'sequelize'
import sqlite3 from 'sqlite3'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt } from './unit-setup.mjs'


//spec: CLAUDE_rulebook.md之R-LIFE(sequelize實例生命週期, LW7已解)
//  R-LIFE-1 initAdodb回傳之實例自帶其sequelize, close只關自己的且冪等; 不再有實例層共用之sequelize變數
//  R-LIFE-2 7個函數之內部自動初始化者於finally關閉自己建立的實例(useStable:false並行亦然)
//  R-LIFE-3 model匯入失敗時initSequelize建立之Sequelize亦關閉
//  事實(審計): 主實例只importModels取rawAttributes, 從未開啟sqlite3連線; 真正開連線的是queryMemory內每次呼叫自建並於finally關閉之實例, 故sqlite3連線數開=關
//表: users(id TEXT PK, name TEXT, value DOUBLE)


let nm = 'instance-lifecycle'


//攔截: 以connectionManager於建構子內之指派計Sequelize建立數(含model匯入失敗而未呼叫define者), 以close計關閉; 以Proxy計sqlite3.Database開啟數
let made = new Set()
let closeCalls = new Map()
let nDbOpened = 0
let nDbClosed = 0
let oClose = null
let oDb = null
let oDbClose = null

function hook() {
    made = new Set()
    closeCalls = new Map()
    nDbOpened = 0
    nDbClosed = 0
    Object.defineProperty(Sequelize.prototype, 'connectionManager', {
        configurable: true,
        get() {
            return undefined
        },
        set(v) {
            made.add(this)
            Object.defineProperty(this, 'connectionManager', { value: v, writable: true, configurable: true, enumerable: true })
        },
    })
    oClose = Sequelize.prototype.close
    Sequelize.prototype.close = function(...a) {
        closeCalls.set(this, (closeCalls.get(this) || 0) + 1)
        return oClose.apply(this, a)
    }
    oDb = sqlite3.Database
    oDbClose = oDb.prototype.close
    oDb.prototype.close = function(...a) {
        nDbClosed++
        return oDbClose.apply(this, a)
    }
    sqlite3.Database = new Proxy(oDb, {
        construct(t, args, nt) {
            nDbOpened++
            return Reflect.construct(t, args, nt)
        },
    })
}

function unhook() {
    delete Sequelize.prototype.connectionManager
    Sequelize.prototype.close = oClose
    oDb.prototype.close = oDbClose
    sqlite3.Database = oDb
}

function nLeaked() {
    return [...made].filter((s) => !closeCalls.has(s)).length
}


if (isWindows()) {
    describe('WOrmMdb instance-lifecycle(R-LIFE: 實例自帶sequelize, 各自釋放)', function() {

        let st = null
        before(function() {
            st = setupStorage(nm)
            hook()
        })
        after(function() {
            unhook()
            cleanStorage(st.fdTmp)
        })
        beforeEach(function() {
            made = new Set()
            closeCalls = new Map()
            nDbOpened = 0
            nDbClosed = 0
        })

        function mk(ext = {}) {
            let w = wo(mkOpt(st.fpStorage, ext))
            w.on('error', function() {})
            return w
        }

        //seed, 以受測物件之insert寫入初始列(此函數本身亦會建關實例, 之後歸零計數)
        async function seed(w) {
            await w.delAll()
            await w.insert([{ id: 'r1', name: 'a' }, { id: 'r2', name: 'b' }])
            made = new Set()
            closeCalls = new Map()
            nDbOpened = 0
            nDbClosed = 0
        }

        //o為option(如{instance: si})
        const FN = {
            select: (w, i, o) => w.select({ name: 'a' }, o),
            selectByPk: (w, i, o) => w.selectByPk('r1', o),
            insert: (w, i, o) => w.insert({ id: `n${i}`, name: 'y' }, o),
            insertBulk: (w, i, o) => w.insertBulk({ id: `n${i}`, name: 'y' }, o),
            save: (w, i, o) => w.save({ id: 'r1', name: `y${i}` }, o),
            del: (w, i, o) => w.del({ id: `n${i}` }, o),
            delAll: (w, i, o) => w.delAll({ name: 'zzz' }, o),
        }

        describe('useStable:false 並行(原漏關K−1個)', function() {

            for (let [fname, fn] of Object.entries(FN)) {
                it(`${fname} × 8並行: Sequelize建立數 = 關閉數, 每個恰關一次, sqlite3連線開 = 關`, async function() {
                    let w = mk({ useStable: false })
                    await seed(w)
                    //註: useStable為false時Jet於同行程高併發偶發開檔錯誤(LD4), 本案只驗sequelize之生命週期, 不要求每個呼叫皆成功
                    await Promise.allSettled(Array.from({ length: 8 }, (_, i) => fn(w, i)))
                    assert.strict.ok(made.size >= 8, `至少8個(實 ${made.size})`)
                    assert.strict.strictEqual(nLeaked(), 0, `未關閉 ${nLeaked()}/${made.size}`)
                    assert.strict.ok([...closeCalls.values()].every((n) => n === 1), '每個實例恰關一次')
                    assert.strict.strictEqual(nDbOpened, nDbClosed, 'sqlite3連線開 = 關')
                })
            }

            for (let K of [1, 2, 16]) {
                it(`select × ${K}並行`, async function() {
                    let w = mk({ useStable: false })
                    await seed(w)
                    let rs = await Promise.allSettled(Array.from({ length: K }, () => w.select({ name: 'a' })))
                    let nOk = rs.filter((r) => r.status === 'fulfilled').length
                    assert.strict.strictEqual(made.size, K + nOk, '每次呼叫: 主實例; 讀取成功者另有queryMemory之實例')
                    assert.strict.strictEqual(nLeaked(), 0)
                })
            }

            it('合法與不合法之find混合: 不合法者不建立實例, 合法者皆關閉', async function() {
                let w = mk({ useStable: false })
                await seed(w)
                let rs = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => w.select(i % 2 ? { name: 'a' } : { name: { $regex: 'a' } })))
                assert.strict.strictEqual(rs.filter((r, i) => i % 2 === 0 && r.status === 'rejected').length, 4, '4個不合法者皆reject')
                let nOk = rs.filter((r, i) => i % 2 === 1 && r.status === 'fulfilled').length
                assert.strict.strictEqual(made.size, 4 + nOk, '不合法者不建立實例; 合法者主實例 + 讀取成功者之queryMemory實例')
                assert.strict.strictEqual(nLeaked(), 0)
            })

        })

        describe('option.instance(七個入口皆須: 呼叫本身不關閉外部實例, 最後由持有者close才關; 外審argon F6)', function() {

            for (let [fname, fn] of Object.entries(FN)) {
                it(`${fname}: 傳入之外部實例不被關閉, si.close()後才關`, async function() {
                    let w = mk({ useStable: false })
                    await seed(w)
                    let si = await w.init()
                    let main = [...made][0]
                    assert.strict.ok(main, 'init建立之主實例')
                    await fn(w, 0, { instance: si })
                    assert.strict.strictEqual(closeCalls.has(main), false, '呼叫後外部實例仍未關閉')
                    await si.close()
                    assert.strict.strictEqual(closeCalls.get(main), 1)
                    assert.strict.strictEqual(nLeaked(), 0)
                })
            }

        })

        describe('壞find(select、delAll): 不載入model、不建立任何Sequelize實例, 故其finally不得關閉他次呼叫之實例', function() {

            for (let fname of ['select', 'delAll']) {
                it(`${fname}: 白名單外之find整批reject且不建立實例; 同時並行之合法呼叫不受影響`, async function() {
                    let w = mk({ useStable: false })
                    await seed(w)
                    let rs = await Promise.allSettled([
                        w[fname]({ name: { $regex: 'a' } }),
                        w[fname]({ name: 'zzz' }),
                        w[fname]({ name: { $regex: 'b' } }),
                    ])
                    assert.strict.strictEqual(rs[0].status, 'rejected')
                    assert.strict.strictEqual(rs[2].status, 'rejected')
                    assert.strict.strictEqual(nLeaked(), 0)
                    assert.strict.ok(made.size >= 1, '合法呼叫仍建立自己的實例')
                })
            }

        })

        describe('useStable:true(回歸)', function() {

            it('select × 8: 無漏關', async function() {
                let w = mk({ useStable: true })
                await seed(w)
                await Promise.all(Array.from({ length: 8 }, () => w.select({ name: 'a' })))
                assert.strict.strictEqual(made.size, 16)
                assert.strict.strictEqual(nLeaked(), 0)
            })

        })

        describe('外部實例 init() / option.instance', function() {

            it('init兩次再依序close: 各關自己的(原: 先建者永不關, 後者之close關的是別人的)', async function() {
                let w = mk()
                let a = await w.init()
                let b = await w.init()
                assert.strict.strictEqual(made.size, 2)
                await a.close()
                assert.strict.strictEqual(closeCalls.size, 1)
                assert.strict.ok(closeCalls.has([...made][0]), 'a關的是a自己建的')
                await b.close()
                assert.strict.strictEqual(nLeaked(), 0)
            })

            it('同一實例重複close為空操作(sequelize.close只被呼叫一次), 含「第一次即並行呼叫」(旗標須在await之前置位)', async function() {
                let w = mk()
                let a = await w.init()
                await Promise.all([a.close(), a.close(), a.close()])
                assert.strict.strictEqual([...closeCalls.values()][0], 1, '並行首次close')
                await a.close()
                assert.strict.strictEqual([...closeCalls.values()][0], 1, '之後再close')
            })

            it('8個並行init再各自close: 無漏關', async function() {
                let w = mk({ useStable: false })
                let sis = await Promise.all(Array.from({ length: 8 }, () => w.init()))
                assert.strict.strictEqual(made.size, 8)
                await Promise.all(sis.map((s) => s.close()))
                assert.strict.strictEqual(nLeaked(), 0)
            })

            it('option.instance: 8次select共用一實例, 呼叫本身不關閉它, 最後close才關', async function() {
                let w = mk({ useStable: false })
                await seed(w)
                let si = await w.init()
                await Promise.all(Array.from({ length: 8 }, () => w.select({ name: 'a' }, { instance: si })))
                let main = [...made].find((s) => !closeCalls.has(s))
                assert.strict.ok(main, '共用之主實例在呼叫後仍未關閉')
                await si.close()
                assert.strict.strictEqual(nLeaked(), 0)
            })

        })

        describe('model匯入失敗(R-LIFE-3)', function() {

            it('select × 5: 皆reject, 匯入失敗而未回傳之Sequelize亦關閉', async function() {
                let w = mk({ cl: 'no_such_model' })
                for (let i = 0; i < 5; i++) {
                    await assert.rejects(w.select({}), /can not import model/)
                }
                assert.strict.strictEqual(made.size, 5)
                assert.strict.strictEqual(nLeaked(), 0)
            })

            it('init(): si.err有值, si.close()關閉該次建立者', async function() {
                let w = mk({ cl: 'no_such_model' })
                let si = await w.init()
                assert.strict.ok(si.err)
                assert.strict.strictEqual(made.size, 1)
                assert.strict.strictEqual(nLeaked(), 0, 'init匯入失敗時已關閉')
                await si.close()
            })

        })

    })
}
