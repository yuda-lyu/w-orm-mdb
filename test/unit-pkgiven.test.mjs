import fs from 'fs'
import path from 'path'
import assert from 'assert'
import { importSrc } from './tools/srcDir.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'


//spec: sgud/rule/rulebook_pk.md 之 R-PKGIVEN(第557項, w-orm系列規則一: 主鍵「給了而非字串」即拒絕)
//  S1 未帶主鍵只有三種: id為undefined、null、空字串(含鍵不存在); autoGenPk為true自動產生, 為false依既有整批reject(invalid data[k].id, autoGenPk is false)
//  S2 給了而非有效主鍵(布林、物件、陣列、Date、BigInt、Symbol、NaN、±Infinity、String與Number包裝物件)一律拒絕, 不得靜默換成新產生之主鍵寫入, 不隨autoGenPk改變:
//     insert與insertBulk於初始化之前整批reject, 訊息invalid id: not a string or finite number at [data[k].id](固定詞彙, 不回顯值; 本庫接受有限數字, 訊息與同為型別化後端之w-orm-reladb同一句), 發出一次error事件、不發change事件、資料庫不變;
//     save該筆ok為0附同訊息之err(逐筆通道, 不改為整批reject), 同批其餘筆照常
//  S3 del、selectByPk、select、delAll: 給了而非有效主鍵者不命中任何列(del該筆ok為0、selectByPk回null、find之條件拒收或不命中), 不刪除任何列; 刪查入口既有之處置核實不改
//  S4 與其他w-orm套件之差異(有意保留): 有限數字為有效主鍵(字串類主鍵欄依String(v)存為字串, 數值類主鍵欄存為數字, R-PK-02), 因本套件之model可宣告數值類主鍵欄
//註: 每個案例前後以原生SQL(經jet)清表與驗證, 驗證不倚賴受測之函數
//註: 本檔以importSrc取受測之src, 可以WORM_SRC_DIR指向修改前之src做[修前紅]


const nm = 'pkgiven'
const fdTmp = `./test/temp-${nm}`
const fdModels = `${fdTmp}/models`
const fpStorage = `${fdTmp}/${nm}.mdb`
const MSG0 = 'invalid id: not a string or finite number at [data[0].id]'
const MSG1 = 'invalid id: not a string or finite number at [data[1].id]'


//bads, 給了而非有效主鍵之值(每次呼叫產生新物件); secret為不得出現於任何對外訊息之字樣
const bads = [
    { nm: 'true', mk: () => true },
    { nm: 'false', mk: () => false },
    { nm: '{}', mk: () => ({}) },
    { nm: '含秘密字樣之物件', mk: () => ({ secret: 'PKSECRET-1' }), secret: 'PKSECRET-1' },
    { nm: '[]', mk: () => [] },
    { nm: '含一個字串元素之陣列', mk: () => ['a'] },
    { nm: 'Date', mk: () => new Date(0) },
    { nm: 'BigInt', mk: () => 10n },
    { nm: 'Symbol', mk: () => Symbol('s') },
    { nm: 'NaN', mk: () => NaN },
    { nm: 'Infinity', mk: () => Infinity },
    { nm: '-Infinity', mk: () => -Infinity },
    { nm: 'new String("a")(與既有列a同值)', mk: () => new String('a') }, // eslint-disable-line no-new-wrappers
    { nm: 'new String("")', mk: () => new String('') }, // eslint-disable-line no-new-wrappers
    { nm: 'new String(含秘密字樣)', mk: () => new String('PKSECRET-2'), secret: 'PKSECRET-2' }, // eslint-disable-line no-new-wrappers
    { nm: 'new Number(5)', mk: () => new Number(5) }, // eslint-disable-line no-new-wrappers
]


if (isWindows()) {
    describe('WOrmMdb pkgiven(R-PKGIVEN)', function() {

        let wo = null
        let jetOpen = null
        let pk = null
        let jet = null

        //mk, 建實例並收集事件; 回傳{ w, evs }
        function mk(cl, ext = {}) {
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

        //seed, 以原生SQL清表並寫入初始列
        async function seed(cl, rows) {
            let cmds = [{ type: 'execute', sql: `DELETE FROM [${cl}]` }]
            for (let r of rows) {
                let ks = Object.keys(r)
                cmds.push({ type: 'execute', sql: `INSERT INTO [${cl}] (${ks.map((k) => `[${k}]`).join(', ')}) VALUES (${ks.map((k) => (typeof r[k] === 'number' ? String(r[k]) : `'${r[k]}'`)).join(', ')})` })
            }
            let res = await jet.run(cmds)
            assert.strict.ok(res.ok, `seed ${cl} failed: ${res.error}`)
        }

        //all, 以原生SQL讀全表之id
        async function ids(cl) {
            return (await jet.query(`SELECT * FROM [${cl}]`)).map((r) => r.id).sort()
        }

        before(async function() {
            wo = (await importSrc('WOrmMdb.mjs')).default
            jetOpen = (await importSrc('jet.mjs')).default
            pk = await importSrc('pk.mjs')
            fs.rmSync(fdTmp, { recursive: true, force: true })
            fs.mkdirSync(fdModels, { recursive: true })
            fs.copyFileSync('./test/assets/worm_pk_def.mdb', fpStorage)
            for (let fn of fs.readdirSync('./test/assets/models')) {
                fs.copyFileSync(path.join('./test/assets/models', fn), path.join(fdModels, fn))
            }
            jet = jetOpen({ path: path.resolve(fpStorage), password: '' })
        })

        after(function() {
            cleanStorage(fdTmp)
        })


        describe('normPk純函數(只收原始值)', function() {

            it('String與Number包裝物件為無效(原為拆包後同原始值處置), 不分主鍵欄型別', function() {
                for (let tp of ['str', 'int', 'flt', 'other']) {
                    for (let v of [new String('k2'), new String(''), new Number(12), new Number(NaN)]) { // eslint-disable-line no-new-wrappers
                        assert.strict.strictEqual(pk.normPk(v, tp).kind, 'invalid', `${tp} ${Object.prototype.toString.call(v)}`)
                    }
                }
            })

            it('原始值之處置不變: 非空字串與有限數字為有效', function() {
                assert.strict.deepStrictEqual(pk.normPk('k2', 'str'), { kind: 'ok', v: 'k2' })
                assert.strict.deepStrictEqual(pk.normPk(12, 'str'), { kind: 'ok', v: '12' })
                assert.strict.deepStrictEqual(pk.normPk(12, 'int'), { kind: 'ok', v: 12 })
                assert.strict.deepStrictEqual(pk.normPk('12', 'int'), { kind: 'ok', v: 12 })
            })

            it('chkPkWf只檢原始字串, 包裝物件非字串(回null, 由寫入入口以給了而非字串拒絕)', function() {
                let H = '\uD800'
                assert.strict.notStrictEqual(pk.chkPkWf(H), null)
                assert.strict.strictEqual(pk.chkPkWf(new String(H)), null) // eslint-disable-line no-new-wrappers
                assert.strict.strictEqual(pk.chkPkWf(new String('ok')), null) // eslint-disable-line no-new-wrappers
            })

        })


        for (let autoGenPk of [true, false]) {

            describe(`給了而非有效主鍵: 拒絕而不得換成新主鍵(autoGenPk: ${autoGenPk}; S2)`, function() {

                let ctx = null

                before(function() {
                    ctx = mk('users', { autoGenPk })
                })

                for (let api of ['insert', 'insertBulk']) {
                    for (let c of bads) {
                        it(`${api}: ${c.nm}整批reject、error事件恰一次、資料庫不變`, async function() {
                            let { w, evs } = ctx
                            await seed('users', [{ id: 'a', name: 'seed' }])
                            evs.error.length = 0
                            evs.change.length = 0
                            let r = null
                            let rej = null
                            try {
                                r = await w[api]([{ id: c.mk(), name: 'x' }])
                            }
                            catch (err) {
                                rej = err
                            }
                            //S2
                            assert.strict.strictEqual(rej === null ? `resolved ${JSON.stringify(r)}` : rej.message, MSG0)
                            assert.strict.deepStrictEqual(await ids('users'), ['a'], '不得以新主鍵寫入, 既有列不變')
                            assert.strict.strictEqual(evs.error.length, 1)
                            assert.strict.strictEqual(evs.error[0].mode, api)
                            assert.strict.strictEqual(evs.error[0].msg, MSG0)
                            assert.strict.strictEqual(evs.change.length, 0)
                            if (c.secret) {
                                assert.strict.ok(rej.message.indexOf(c.secret) < 0 && evs.error[0].msg.indexOf(c.secret) < 0, '不回顯值')
                            }
                        })
                    }
                }

                for (let api of ['insert', 'insertBulk']) {
                    it(`${api}: 同批有合格列時整批不寫(以索引最小之不合格者為準)`, async function() {
                        let { w, evs } = ctx
                        await seed('users', [{ id: 'a', name: 'seed' }])
                        evs.error.length = 0
                        await assert.rejects(() => w[api]([{ id: 'ok1', name: 'x' }, { id: true, name: 'y' }, { id: {}, name: 'z' }]), (err) => err.message === MSG1)
                        assert.strict.deepStrictEqual(await ids('users'), ['a'])
                        assert.strict.strictEqual(evs.error.length, 1)
                    })
                }

                for (let c of bads) {
                    it(`save: ${c.nm}該筆ok為0附err(逐筆通道, 不改為整批reject), 不寫入`, async function() {
                        let { w, evs } = ctx
                        await seed('users', [{ id: 'a', name: 'seed' }])
                        evs.change.length = 0
                        let r = await w.save([{ id: c.mk(), name: 'x' }])
                        assert.strict.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, MSG0]], 'S2')
                        assert.strict.deepStrictEqual(await ids('users'), ['a'])
                        if (c.secret) {
                            assert.strict.ok(JSON.stringify(r).indexOf(c.secret) < 0, '不回顯值')
                        }
                    })
                }

                it('save: 同批其餘筆照常(合格者寫入, 不合格者ok為0)', async function() {
                    let { w } = ctx
                    await seed('users', [{ id: 'a', name: 'seed' }])
                    let r = await w.save([{ id: 'ok1', name: 'x' }, { id: [], name: 'y' }, { id: 'ok2', name: 'z' }])
                    assert.strict.deepStrictEqual(r.map((v) => v.ok), [1, 0, 1])
                    assert.strict.strictEqual(r[1].err, MSG1)
                    assert.strict.deepStrictEqual(await ids('users'), ['a', 'ok1', 'ok2'])
                })

                it('save: autoInsert為false時給了而非字串者同為該筆ok為0(不降為靜默)', async function() {
                    let { w } = ctx
                    await seed('users', [{ id: 'a', name: 'seed' }])
                    let r = await w.save([{ id: false, name: 'x' }], { autoInsert: false })
                    assert.strict.deepStrictEqual(r.map((v) => [v.ok, v.err]), [[0, MSG0]])
                })

                for (let c of bads) {
                    it(`del: ${c.nm}該筆ok為0(既有處置核實不改), 不刪除既有列a`, async function() {
                        let { w } = ctx
                        await seed('users', [{ id: 'a', name: 'seed' }])
                        let r = await w.del([{ id: c.mk() }])
                        assert.strict.strictEqual(r.length, 1)
                        assert.strict.strictEqual(r[0].ok, 0, 'S3')
                        assert.strict.strictEqual(r[0].nDeleted, 0)
                        assert.strict.deepStrictEqual(await ids('users'), ['a'], 'new String("a")不得刪到a(原為拆包後刪除)')
                    })
                }

                for (let c of bads) {
                    it(`selectByPk: ${c.nm}回null(不命中既有列a, 原new String("a")拆包後命中)`, async function() {
                        let { w, evs } = ctx
                        await seed('users', [{ id: 'a', name: 'seed' }])
                        evs.error.length = 0
                        assert.strict.strictEqual(await w.selectByPk(c.mk()), null, 'S3')
                        assert.strict.strictEqual(evs.error.length, 0, '可讀而非字串者不是錯誤')
                    })
                }

                it('select與delAll: 給了而非有效主鍵之條件不命中任何列、不刪除(白名單拒收或不命中, 核實不改)', async function() {
                    let { w } = ctx
                    await seed('users', [{ id: 'a', name: 'seed' }])
                    for (let c of bads) {
                        let rs = await w.select({ id: c.mk() }).catch(() => [])
                        assert.strict.deepStrictEqual(rs, [], `select ${c.nm}`)
                        let rd = await w.delAll({ id: c.mk() }).catch(() => ({ nDeleted: 0 }))
                        assert.strict.strictEqual(rd.nDeleted, 0, `delAll ${c.nm}`)
                    }
                    assert.strict.deepStrictEqual(await ids('users'), ['a'])
                })

            })

        }


        describe('未帶主鍵只有三種: undefined、null、空字串(含鍵不存在; S1)', function() {

            let mkNot = [
                { nm: '鍵不存在', mk: () => ({ name: 'x' }) },
                { nm: 'undefined', mk: () => ({ id: undefined, name: 'x' }) },
                { nm: 'null', mk: () => ({ id: null, name: 'x' }) },
                { nm: '空字串', mk: () => ({ id: '', name: 'x' }) },
            ]

            for (let api of ['insert', 'insertBulk', 'save']) {
                for (let c of mkNot) {
                    it(`${api}: ${c.nm}且autoGenPk為true時自動產生36碼主鍵`, async function() {
                        let { w } = mk('users', { autoGenPk: true })
                        await seed('users', [])
                        await w[api]([c.mk()])
                        let rs = await ids('users')
                        assert.strict.strictEqual(rs.length, 1)
                        assert.strict.strictEqual(rs[0].length, 36)
                    })
                    it(`${api}: ${c.nm}且autoGenPk為false時維持既有整批reject, 不寫入`, async function() {
                        let { w } = mk('users', { autoGenPk: false })
                        await seed('users', [])
                        await assert.rejects(() => w[api]([c.mk()]), (err) => err.message === 'invalid data[0].id, autoGenPk is false')
                        assert.strict.deepStrictEqual(await ids('users'), [])
                    })
                }
            }

        })


        describe('有限數字仍為有效主鍵(S4, 與其他w-orm套件之有意差異; R-PK-02)', function() {

            it('字串類主鍵欄: insert({id:5})存為字串"5", selectByPk(5)命中', async function() {
                let { w } = mk('users')
                await seed('users', [{ id: 'a', name: 'seed' }])
                assert.strict.deepStrictEqual(await w.insert([{ id: 5, name: 'five' }]), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.deepStrictEqual(await ids('users'), ['5', 'a'])
                assert.strict.strictEqual((await w.selectByPk(5)).name, 'five')
            })

            it('數值類主鍵欄(ipk): insert、save、selectByPk、del以數字操作皆有效', async function() {
                let { w } = mk('ipk')
                await seed('ipk', [])
                assert.strict.deepStrictEqual(await w.insert([{ id: 5, name: 'five' }]), { n: 1, nInserted: 1, ok: 1 })
                assert.strict.strictEqual((await w.save([{ id: 5, name: 'five2' }]))[0].ok, 1)
                assert.strict.strictEqual((await w.selectByPk(5)).name, 'five2')
                assert.strict.deepStrictEqual(await w.del([{ id: 5 }]), [{ n: 1, nDeleted: 1, ok: 1 }])
            })

            it('數值類主鍵欄(ipk): 給了而非有效主鍵(true、{}、new Number(5))同樣拒絕, 不補值', async function() {
                let { w } = mk('ipk')
                await seed('ipk', [{ id: 1, name: 'seed' }])
                for (let mkv of [() => true, () => ({}), () => new Number(5)]) { // eslint-disable-line no-new-wrappers
                    await assert.rejects(() => w.insert([{ id: mkv(), name: 'x' }]), (err) => err.message === MSG0)
                }
                assert.strict.deepStrictEqual(await ids('ipk'), [1])
            })

        })

    })
}
