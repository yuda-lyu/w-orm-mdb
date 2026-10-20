import fs from 'fs'
import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import * as pk from '../src/pk.mjs'
import { escId, escVal, getInsert, getUpdate, getSelectAll } from '../src/getCmd.mjs'
import { isWindows, cleanStorage } from './unit-setup.mjs'
import { mk, msgOf, setupWf, freshWo } from './unit-wf-setup.mjs'


//spec: CLAUDE_rulebook.md 之 R-WF(字串良構檢核, dspec〈一之三〉9., 第66項批2)
//本檔: 案例表(unit-wf1~6)之外的專屬斷言: 純函數、建構設定、escVal最後防線、預檢先於初始化(匯入model)、
//呼叫當下複製(snap)、檢查之值即使用之值(繼承存取器)、去回顯、站點掃描
//註: 案例表之資料表twf由test/assets/worm_wf_def.mdb提供, 另以worm_pk_def.mdb之ipk(整數主鍵)驗型別不符訊息


const H = 'a\uD800' //孤立高位
const L = 'a\uDC00' //孤立低位
const S255 = 'x'.repeat(255)
const WHY_LONE = 'string contains lone surrogate'
const WHY_NUL = 'string contains NUL'


describe('WOrmMdb wellformed 純函數(R-WF-01)', function() {

    it('chkPkWf: 良構與非字串回null, NUL先於孤立代理, 先拆包裝物件', function() {
        for (let v of ['abc', '中文', 'a\u{1F600}b', 'a�b', '\u{20BB7}', 'é', 123, null, undefined, {}, [], true, '']) {
            assert.strict.strictEqual(pk.chkPkWf(v), null, `pk.chkPkWf(${String(v)})`)
        }
        assert.strict.strictEqual(pk.chkPkWf(H), WHY_LONE)
        assert.strict.strictEqual(pk.chkPkWf(L), WHY_LONE)
        assert.strict.strictEqual(pk.chkPkWf('\uD800'), WHY_LONE)
        assert.strict.strictEqual(pk.chkPkWf('a\uDC00\uD800'), WHY_LONE, '反序代理對')
        assert.strict.strictEqual(pk.chkPkWf('a\u0000b'), WHY_NUL)
        assert.strict.strictEqual(pk.chkPkWf('a\u0000\uD800'), WHY_NUL, 'NUL先報')
        /* eslint-disable no-new-wrappers */
        assert.strict.strictEqual(pk.chkPkWf(new String(H)), WHY_LONE, '包裝物件先拆包裝(與normPk一致)')
        assert.strict.strictEqual(pk.chkPkWf(new String('ok')), null)
        /* eslint-enable no-new-wrappers */
    })

    it('normPk: 不良構字串為cannot且附why, 超過255字元為cannot而無why, 不得為invalid(以免autoGenPk補值取代)', function() {
        for (let tp of ['str', 'int', 'flt', 'other']) {
            assert.strict.deepStrictEqual(pk.normPk(H, tp), { kind: 'cannot', why: WHY_LONE }, tp)
            assert.strict.deepStrictEqual(pk.normPk('a\u0000', tp), { kind: 'cannot', why: WHY_NUL }, tp)
        }
        assert.strict.deepStrictEqual(pk.normPk(S255 + 'y', 'str'), { kind: 'cannot' })
        assert.strict.deepStrictEqual(pk.normPk('ok', 'str'), { kind: 'ok', v: 'ok' })
        assert.strict.deepStrictEqual(pk.normPk('', 'str'), { kind: 'invalid' }, '空字串仍為invalid')
    })

})


describe('WOrmMdb wellformed escVal最後防線(R-WF-02)', function() {

    it('字串進入SQL文字之唯一出口: 孤立代理拋錯且不回顯值, NUL維持現況(不由此拒收)', function() {
        for (let v of [H, L, '\uD800', new String(H), { toString() { return 'x\uDC00' } }, ['ok', H]]) { // eslint-disable-line no-new-wrappers
            assert.strict.throws(() => escVal(v), (err) => err.message === `invalid data: ${WHY_LONE}`, `escVal(${typeof v})`)
        }
        assert.strict.strictEqual(escVal('a\u{1F600}'), `'a\u{1F600}'`)
        assert.strict.strictEqual(escVal('a�'), `'a�'`)
        assert.strict.strictEqual(escVal(`it's`), `'it''s'`)
        assert.strict.strictEqual(escVal('a\u0000b'), `'a\u0000b'`, '值之NUL不屬共用檢核, 現況由Jet報錯')
        assert.strict.strictEqual(escVal(5), '5')
        assert.strict.strictEqual(escVal(null), 'NULL')
    })

    it('getInsert、getUpdate經由escVal, 任一欄位值含孤立代理即拋錯', function() {
        assert.strict.throws(() => getInsert('t', ['id', 'name'], { id: 'k', name: H }), /invalid data: string contains lone surrogate/)
        assert.strict.throws(() => getUpdate('t', ['id', 'name'], { id: 'k', name: L }, 'id', 'k'), /invalid data: string contains lone surrogate/)
        assert.strict.strictEqual(getInsert('t', ['id', 'name'], { id: 'k', name: 'v' }), `INSERT INTO [t] ([id], [name]) VALUES ('k', 'v')`)
    })

})


if (isWindows()) {

    describe('WOrmMdb wellformed 建構設定(opt.db、opt.cl、opt.url、opt.storage、opt.pk)', function() {

        const ctor = (ext) => () => wo({ url: 'mdb://:', db: 'worm', cl: 'twf', storage: './test/temp-wellformed/none.mdb', ...ext })

        for (let k of ['db', 'cl', 'url', 'storage', 'pk']) {
            for (let [lb, s] of [['孤立高位', H], ['孤立低位', L], ['反序代理對', 'a\uDC00\uD800']]) {
                it(`opt.${k}含${lb}: 建構即throw固定詞彙`, function() {
                    let v = k === 'url' ? `mdb://:${s}` : s
                    assert.strict.throws(ctor({ [k]: v }), (err) => err.message === `invalid opt.${k}: ${WHY_LONE}`)
                })
            }
        }

        it('良構名稱(emoji、U+FFFD、CJK擴充B區)可建構; db與cl含NUL不屬本規則而不拋invalid opt', function() {
            for (let k of ['db', 'cl']) {
                for (let s of ['a\u{1F600}', 'a�b', '\u{20BB7}野家']) {
                    assert.strict.doesNotThrow(ctor({ [k]: s }), `opt.${k}=${s}`)
                }
                assert.strict.doesNotThrow(ctor({ [k]: 'a\u0000b' }), `opt.${k}含NUL`)
            }
        })

        it('String包裝物件不是原始字串: 建構throw not a string(原為接受)', function() {
            for (let k of ['db', 'cl', 'storage']) {
                assert.strict.throws(ctor({ [k]: new String('x') }), (err) => err.message === `invalid opt.${k}: not a string`, k) // eslint-disable-line no-new-wrappers
            }
        })

        it('檢核先於opt.url之解析(解析錯誤訊息會回顯opt.url, 不得因此回顯孤立代理)', function() {
            assert.strict.throws(ctor({ url: `bad://${H}` }), (err) => err.message === `invalid opt.url: ${WHY_LONE}` && !err.message.includes('\uD800'))
        })

    })

    describe('WOrmMdb wellformed 專屬斷言(R-WF-03~06)', function() {

        let ctx = null

        before(function() {
            ctx = setupWf('wellformed')
            for (let fn of ['ipk.js', 'tt.js']) {
                fs.copyFileSync(`./test/assets/models/${fn}`, `${ctx.fdModels}/${fn}`)
            }
        })

        after(function() {
            cleanStorage('./test/temp-wellformed')
        })

        async function ids(w) {
            return (await w.select()).map((v) => v.id).sort()
        }

        describe('預檢先於初始化(匯入model): 壞輸入不載入model、不連線(cl指向不存在之model)', function() {

            it('insert、insertBulk: 壞輸入reject為invalid id/data, 良構輸入才報找不到model', async function() {
                for (let api of ['insert', 'insertBulk']) {
                    let { w, ev } = freshWo(ctx, { cl: 'nomodel' })
                    let rej = await w[api]([mk('g0'), mk(H)]).catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej), `invalid id: ${WHY_LONE} at [data[1].id]`, api)
                    assert.strict.deepStrictEqual(ev.order, ['error'], api)
                    let rej2 = await w[api]([mk('g0', { name: H })]).catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej2), `invalid data: ${WHY_LONE} at [data[0].name]`, api)
                    let rej3 = await w[api]([mk('g0')]).catch((e) => e)
                    assert.strict.ok(rej3 instanceof Error || typeof rej3 === 'string', api)
                    assert.strict.ok(!/^invalid (id|data)/.test(msgOf(rej3)), `${api}: 良構輸入應報model錯誤, 實為[${msgOf(rej3)}]`)
                }
            })

            it('save、del: 全數不合格則不初始化(不報model錯誤、逐筆ok為0); 含合格筆才初始化(報model錯誤)', async function() {
                let { w, ev } = freshWo(ctx, { cl: 'nomodel' })
                let rs = await w.save([mk(H), mk(L, { name: 'x' })])
                assert.strict.deepStrictEqual(rs, [
                    { n: 1, nInserted: 0, nModified: 0, ok: 0, err: `invalid id: ${WHY_LONE} at [data[0].id]` },
                    { n: 1, nInserted: 0, nModified: 0, ok: 0, err: `invalid id: ${WHY_LONE} at [data[1].id]` },
                ])
                assert.strict.deepStrictEqual(ev.order, ['error', 'error', 'change'], 'save: 逐筆error事件各一次, 其後整批change')
                ev.order.length = 0
                let rd = await w.del([mk(H), mk('a\u0000b')])
                assert.strict.deepStrictEqual(rd, [
                    { n: 0, nDeleted: 0, ok: 0, err: `invalid id: ${WHY_LONE} at [data[0].id]` },
                    { n: 0, nDeleted: 0, ok: 0, err: `invalid id: ${WHY_NUL} at [data[1].id]` },
                ])
                assert.strict.deepStrictEqual(ev.order, ['error', 'error', 'change'])
                let rej1 = await w.save([mk(H), mk('g1')]).catch((e) => e)
                assert.strict.ok(!Array.isArray(rej1) && !/^invalid (id|data)/.test(msgOf(rej1)), `save含合格筆應報model錯誤, 實為[${msgOf(rej1)}]`)
                let rej2 = await w.del([mk(H), mk('g1')]).catch((e) => e)
                assert.strict.ok(!Array.isArray(rej2) && !/^invalid (id|data)/.test(msgOf(rej2)), `del含合格筆應報model錯誤, 實為[${msgOf(rej2)}]`)
            })

            it('selectByPk: 不良構主鍵回null且不初始化; 良構主鍵才報model錯誤', async function() {
                let { w, ev } = freshWo(ctx, { cl: 'nomodel' })
                for (let v of [H, L, 'a\u0000b', '\uD800']) {
                    assert.strict.strictEqual(await w.selectByPk(v), null)
                }
                assert.strict.deepStrictEqual(ev.order, [], 'selectByPk回null不得發事件')
                let rej = await w.selectByPk('ok').catch((e) => e)
                assert.strict.ok(rej !== null && (rej instanceof Error || typeof rej === 'string'))
            })

        })

        describe('預檢之範圍: del不檢資料欄位; save預檢不合格之筆不進入其後之日期預檢', function() {

            it('del只檢主鍵: 其餘欄位含孤立代理不影響', async function() {
                let { w } = freshWo(ctx, {})
                await w.insertBulk([mk('d1'), mk('d2')])
                let rd = await w.del([{ id: 'd1', name: H, [`k${H}`]: 1 }])
                assert.strict.deepStrictEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }])
                assert.strict.deepStrictEqual(await ids(w), ['d2'])
            })

            it('save: 主鍵不合格之筆不進入日期預檢(其越界日期不使整批reject), 合格筆照常; 合格筆之日期越界仍整批reject', async function() {
                //tt表: fDate為DATETIME
                let { w } = freshWo(ctx, { cl: 'tt' }, './test/assets/worm_pk_def.mdb')
                let rs = await w.save([{ id: H, fDate: new Date('0050-06-15T12:00:00') }, { id: 'ok-1', fDate: new Date('2026-06-15T12:00:00') }])
                assert.strict.deepStrictEqual([rs[0].ok, rs[0].err, rs[1].ok], [0, `invalid id: ${WHY_LONE} at [data[0].id]`, 1])
                let rej = await w.save([{ id: H }, { id: 'ok-2', fDate: new Date('0050-06-15T12:00:00') }]).catch((e) => e)
                assert.strict.ok(rej instanceof Error && rej.message.startsWith('invalid data: date is not a valid time'), msgOf(rej))
                assert.strict.deepStrictEqual((await w.select()).map((v) => v.id), ['ok-1'], '越界整批reject時不寫入任何筆')
            })

        })

        describe('option.instance: 預檢失敗不得關閉呼叫端持有之實例', function() {

            it('insert、insertBulk、save、del預檢失敗後, 同一實例仍可使用', async function() {
                let { w } = freshWo(ctx, {})
                let instance = await w.init()
                await w.insert([mk('k0')], { instance })
                await w.insert([mk(H)], { instance }).catch(() => null)
                await w.insertBulk([mk(H)], { instance }).catch(() => null)
                let rs = await w.save([mk(H)], { instance })
                assert.strict.strictEqual(rs[0].ok, 0)
                let rd = await w.del([mk(H)], { instance })
                assert.strict.strictEqual(rd[0].ok, 0)
                assert.strict.deepStrictEqual((await w.select({}, { instance })).map((v) => v.id), ['k0'], '實例仍可查詢')
                await instance.close()
            })

        })

        describe('呼叫當下複製(snap): 呼叫後立即改動原數據不影響檢核與寫入之值(useStable兩種模式)', function() {

            for (let useStable of [true, false]) {
                it(`insert、insertBulk、save、del(useStable:${useStable})`, async function() {
                    for (let api of ['insert', 'insertBulk', 'save']) {
                        let { w } = freshWo(ctx, { useStable })
                        let rows = [mk('a1', { name: 'orig1' }), mk('a2', { name: 'orig2' })]
                        let p = w[api](rows)
                        rows[0].name = H
                        rows[1].id = 'zzz'
                        rows.push(mk('a3'))
                        await p
                        let all = await w.select()
                        assert.strict.deepStrictEqual(all.map((v) => [v.id, v.name]).sort(), [['a1', 'orig1'], ['a2', 'orig2']], `${api} useStable:${useStable}`)
                    }
                    let { w } = freshWo(ctx, { useStable })
                    await w.insertBulk([mk('a1'), mk('a2')])
                    let rows = [mk('a1')]
                    let p = w.del(rows)
                    rows[0].id = 'a2'
                    await p
                    assert.strict.deepStrictEqual(await ids(w), ['a2'], `del useStable:${useStable}`)
                })
            }

            it('複製拋錯(存取器拋錯)為rejected promise, 同步呼叫不拋', async function() {
                let { w } = freshWo(ctx, {})
                let d = mk('k1')
                Object.defineProperty(d, 'name', { get() { throw new Error('getter boom') }, enumerable: true })
                for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                    let p = w[api]([d])
                    assert.strict.ok(p instanceof Promise, api)
                    let rej = await p.catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej), 'getter boom', api)
                }
            })

        })

        describe('檢查之值即使用之值: 繼承而來之存取器(cloneDeep保留原型)', function() {

            //mkProtoDoc, 原型帶可列舉之存取器name, 第n次讀取依fn(n)回傳
            function mkProtoDoc(id, key, fn) {
                let n = 0
                let proto = {}
                Object.defineProperty(proto, key, {
                    get() {
                        n++
                        return fn(n)
                    },
                    enumerable: true,
                    configurable: true,
                })
                let d = Object.create(proto)
                if (id !== undefined) {
                    d.id = id
                }
                return { d, count: () => n }
            }

            it('繼承存取器第一次讀到不合格值: 以檢核所讀為準而拒收(含路徑)', async function() {
                for (let api of ['insert', 'insertBulk']) {
                    let { w } = freshWo(ctx, {})
                    let { d } = mkProtoDoc('g1', 'name', (n) => (n === 1 ? H : 'ok'))
                    let rej = await w[api]([mk('g0'), d, mk('g2')]).catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej), `invalid data: ${WHY_LONE} at [data[1].name]`, api)
                    assert.strict.deepStrictEqual(await ids(w), [], `${api}: 不得寫入任何一筆`)
                }
                let { w } = freshWo(ctx, {})
                let { d } = mkProtoDoc('g1', 'name', (n) => (n === 1 ? H : 'ok'))
                let rs = await w.save([mk('g0'), d])
                assert.strict.deepStrictEqual([rs[0].ok, rs[1].ok, rs[1].err], [1, 0, `invalid data: ${WHY_LONE} at [data[1].name]`])
            })

            it('繼承存取器每次回傳不同值: 只在呼叫當下被呼叫一次, 檢核與寫入皆為該次所讀(第一次良構、其後不合格不影響)', async function() {
                for (let api of ['insert', 'insertBulk', 'save']) {
                    for (let useStable of [true, false]) {
                        let { w } = freshWo(ctx, { useStable })
                        let { d, count } = mkProtoDoc('g1', 'name', (n) => (n === 1 ? 'ok' : H))
                        let r = await w[api]([mk('g0'), d, mk('g2')]).catch((e) => e)
                        assert.strict.ok(!(r instanceof Error), `${api}: ${msgOf(r)}`)
                        assert.strict.deepStrictEqual((await w.select()).map((v) => [v.id, v.name]).sort(), [['g0', 'n'], ['g1', 'ok'], ['g2', 'n']], `${api} useStable:${useStable}`)
                        assert.strict.strictEqual(count(), 1, `${api}: 存取器只應被呼叫一次`)
                    }
                }
            })

            it('最後防線(escVal): 自訂toString之輸出含孤立代理(chkOrmData看不到)時整批reject、DB不變、不寫入被改寫為U+FFFD之值', async function() {
                for (let api of ['insert', 'insertBulk', 'save']) {
                    let { w, ev } = freshWo(ctx, {})
                    let d = mk('g1', { name: { toString() { return H } } })
                    let rej = await w[api]([mk('g0'), d, mk('g2')]).catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej), `invalid data: ${WHY_LONE}`, `${api}: 最後防線之訊息(無路徑)`)
                    assert.strict.deepStrictEqual(await ids(w), [], `${api}: 不得寫入任何一筆`)
                    assert.strict.deepStrictEqual(ev.order, ['error'], api)
                }
            })

            it('主鍵為繼承存取器: 讀一次並固定, 寫入之主鍵即檢核之主鍵(其後讀值改變不影響)', async function() {
                for (let api of ['insert', 'insertBulk', 'save']) {
                    let { w } = freshWo(ctx, {})
                    let { d, count } = mkProtoDoc(undefined, 'id', (n) => (n === 1 ? 'pk-first' : H))
                    d.name = 'x'
                    let r = await w[api]([d]).catch((e) => e)
                    assert.strict.ok(!(r instanceof Error), `${api}: ${msgOf(r)}`)
                    assert.strict.deepStrictEqual(await ids(w), ['pk-first'], `${api}: 寫入者為第一次所讀之主鍵`)
                    assert.strict.strictEqual(count(), 1, `${api}: 主鍵存取器只應被呼叫一次`)
                }
                let { w } = freshWo(ctx, {})
                await w.insertBulk([mk('pk-first'), mk('keep')])
                let { d } = mkProtoDoc(undefined, 'id', (n) => (n === 1 ? 'pk-first' : H))
                let rd = await w.del([d])
                assert.strict.deepStrictEqual(rd, [{ n: 1, nDeleted: 1, ok: 1 }], 'del以第一次所讀之主鍵刪除')
                assert.strict.deepStrictEqual(await ids(w), ['keep'])
            })

            it('繼承存取器之副作用(改動同列其他欄位)不影響已讀取之值', async function() {
                //原型上可列舉之存取器zz被讀時把this.name改為孤立代理: 各列於呼叫當下攤平為純資料, 檢核與寫入皆用攤平後之值, 副作用只落在被丟棄之原複本
                for (let api of ['insert', 'insertBulk', 'save']) {
                    let { w } = freshWo(ctx, {})
                    let proto = {}
                    Object.defineProperty(proto, 'zz', {
                        get() {
                            this.name = 'side\uD800'
                            return 'zz'
                        },
                        enumerable: true,
                        configurable: true,
                    })
                    let d = Object.create(proto)
                    d.id = 'g1'
                    d.name = 'ok'
                    let r = await w[api]([d]).catch((e) => e)
                    assert.strict.ok(!(r instanceof Error), `${api}: 不應reject, 實為[${msgOf(r)}]`)
                    let rows = await w.select()
                    assert.strict.deepStrictEqual(rows.map((v) => [v.id, v.name]), [['g1', 'ok']], `${api}: 寫入者為檢核所見之值`)
                }
            })

        })

        describe('外審補格(sol):呼叫當下攤平各列後, 存取器副作用、共用原型被改動、主鍵第一次為undefined皆不影響檢核與寫入之值', function() {

            //mkGetterDoc, 原型帶可列舉之存取器key, 讀取時執行fn(this)並回傳ret
            function mkGetterDoc(own, key, ret, fn) {
                let proto = {}
                Object.defineProperty(proto, key, {
                    get() {
                        fn(this)
                        return ret
                    },
                    enumerable: true,
                    configurable: true,
                })
                return Object.assign(Object.create(proto), own)
            }

            it('save更新: 其他欄位之存取器於讀取時把同列主鍵改為另一個良構鍵, 不得更新到另一列(late-omit-getter)', async function() {
                for (let useStable of [true, false]) {
                    let { w } = freshWo(ctx, { useStable })
                    await w.insertBulk([mk('keep', { name: 'keep-before' }), mk('wanted', { name: 'wanted-before' })])
                    let d = mkGetterDoc({ id: 'wanted', name: 'after' }, 'zz', 'zz', (self) => {
                        self.id = 'keep'
                    })
                    let rs = await w.save([d])
                    assert.strict.deepStrictEqual(rs, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }], `useStable:${useStable}`)
                    let rows = Object.fromEntries((await w.select()).map((v) => [v.id, v.name]))
                    assert.strict.deepStrictEqual(rows, { keep: 'keep-before', wanted: 'after' }, `useStable:${useStable}`)
                }
            })

            it('主鍵之存取器第一次回undefined(其後回另一個有效鍵): 以第一次為準, autoGenPk:false 時 save 整批reject、del 該筆ok為0, 不更新也不刪除他列', async function() {
                let { w } = freshWo(ctx, { autoGenPk: false })
                await w.insertBulk([mk('keep', { name: 'keep-before' })])
                let mkd = () => {
                    let n = 0
                    let proto = {}
                    Object.defineProperty(proto, 'id', {
                        get() {
                            n++
                            return n === 1 ? undefined : 'keep'
                        },
                        enumerable: true,
                        configurable: true,
                    })
                    return Object.assign(Object.create(proto), { name: 'after' })
                }
                let rej = await w.save([mkd()]).catch((e) => e)
                assert.strict.strictEqual(msgOf(rej), 'invalid data[0].id, autoGenPk is false')
                let rd = await w.del([mkd()])
                assert.strict.deepStrictEqual(rd, [{ n: 0, nDeleted: 0, ok: 0, err: 'invalid data[0].id' }])
                assert.strict.deepStrictEqual((await w.select()).map((v) => [v.id, v.name]), [['keep', 'keep-before']])
            })

            it('呼叫後立即改動共用之原型: 寫入與刪除仍為呼叫當時之值(insert、insertBulk、save、del; useStable兩種模式)', async function() {
                for (let useStable of [true, false]) {
                    for (let api of ['insert', 'insertBulk', 'save']) {
                        let { w } = freshWo(ctx, { useStable })
                        let proto = { name: 'at-call' }
                        let d = Object.create(proto)
                        d.id = 'p1'
                        let p = w[api]([d])
                        proto.name = 'after-call'
                        await p
                        assert.strict.deepStrictEqual((await w.select()).map((v) => [v.id, v.name]), [['p1', 'at-call']], `${api} useStable:${useStable}`)
                    }
                    let { w } = freshWo(ctx, { useStable })
                    await w.insertBulk([mk('first'), mk('keep')])
                    let proto = { id: 'first' }
                    let d = Object.create(proto)
                    let p = w.del([d])
                    proto.id = 'keep'
                    await p
                    assert.strict.deepStrictEqual(await ids(w), ['keep'], `del useStable:${useStable}`)
                }
            })

            it('前一個呼叫之change事件改動後一個已呼叫之共用原型: 後者仍刪除呼叫當時之值', async function() {
                let { w } = freshWo(ctx, {})
                await w.insertBulk([mk('first'), mk('keep'), mk('x')])
                let proto = { id: 'first' }
                let d = Object.create(proto)
                w.on('change', (mode) => {
                    if (mode === 'save') {
                        proto.id = 'keep'
                    }
                })
                let p1 = w.save([mk('x', { name: 'saved' })])
                let p2 = w.del([d])
                await Promise.all([p1, p2])
                assert.strict.deepStrictEqual(await ids(w), ['keep', 'x'])
            })

            it('相容: 類別實例之getter(不可列舉)與繼承之可列舉屬性照舊被寫入, 且存取器只被呼叫一次', async function() {
                let n = 0
                class P {
                    constructor() {
                        this.id = 'c1'
                    }

                    get name() {
                        n++
                        return 'from-getter'
                    }
                }
                let { w } = freshWo(ctx, {})
                await w.insert([new P(), Object.assign(Object.create({ name: 'inherited' }), { id: 'c2' })])
                assert.strict.deepStrictEqual((await w.select()).map((v) => [v.id, v.name]).sort(), [['c1', 'from-getter'], ['c2', 'inherited']])
                assert.strict.strictEqual(n, 1)
            })

            it('建構設定於建構時讀一次: 存取器每次回傳不同值、建構後改動原opt皆不影響本實例; 預設值不寫回呼叫端之opt', async function() {
                let { fp } = freshWo(ctx, {})
                let n = 0
                let o = {
                    url: 'mdb://:',
                    db: 'worm',
                    fdModels: ctx.fdModels,
                    storage: fp,
                    get cl() {
                        n++
                        return n === 1 ? 'twf' : `twf${H}`
                    },
                }
                let w = wo(o)
                Object.defineProperty(o, 'cl', { value: 'nomodel', configurable: true })
                await w.insert([mk('o1')])
                assert.strict.deepStrictEqual(await ids(w), ['o1'])
                assert.strict.strictEqual(n, 1, 'cl只被讀一次')
                assert.strict.strictEqual(o.pk, undefined, '預設值不寫回呼叫端之opt')
            })

            //第2輪(sol)補格

            it('建構: 自有資料屬性名稱為__proto__之選項(如JSON.parse得到者)不得成為內部設定之原型(以defineProperty複製, 其內容不被採用)', async function() {
                let { fp } = freshWo(ctx, {})
                let n = 0
                let protoOpt = {}
                Object.defineProperty(protoOpt, 'cl', {
                    get() {
                        n++
                        return 'twf'
                    },
                    enumerable: false,
                    configurable: true,
                })
                let o = { url: 'mdb://:', db: 'worm', fdModels: ctx.fdModels, storage: fp }
                Object.defineProperty(o, '__proto__', { value: protoOpt, enumerable: true, configurable: true, writable: true })
                let w = wo(o)
                //原opt並無可見之cl(__proto__僅為普通鍵), 故用預設值test而找不到model; 若以一般指派複製則其內容成為原型而cl變成twf
                let rej = await w.insert([mk('q1')]).catch((e) => e)
                assert.strict.ok(/can not import model: test/.test(msgOf(rej)), msgOf(rej))
                assert.strict.strictEqual(n, 0, 'protoOpt之getter不得被讀')
            })

            it('建構: 不可列舉之選項與類別getter照舊被讀取(不得靜默變成預設值); 非物件之opt為錯誤', async function() {
                let { fp } = freshWo(ctx, {})
                class Opt {
                    constructor() {
                        this.url = 'mdb://:'
                        this.db = 'worm'
                        this.fdModels = ctx.fdModels
                        this.storage = fp
                    }

                    get cl() {
                        return 'twf'
                    }
                }
                let w = wo(new Opt())
                await w.insert([mk('o2')])
                assert.strict.deepStrictEqual(await ids(w), ['o2'])
                let o2 = { url: 'mdb://:', db: 'worm', cl: 'twf', fdModels: ctx.fdModels }
                Object.defineProperty(o2, 'storage', { value: fp, enumerable: false, writable: true, configurable: true })
                let w2 = wo(o2)
                await w2.insert([mk('o3')])
                assert.strict.deepStrictEqual(await ids(w2), ['o2', 'o3'], '不可列舉之storage須被採用(同一個mdb檔)')
                for (let bad of [null, 'abc', 5, true]) {
                    assert.strict.throws(() => wo(bad), (err) => err instanceof TypeError && err.message === 'invalid opt: not an object', String(bad))
                }
            })

            it('陣列之子類別作為列: 主鍵存取器亦被攤平固定(第一次undefined或換鍵皆以第一次為準)', async function() {
                for (let first of [undefined, 'first']) {
                    let { w } = freshWo(ctx, { autoGenPk: false })
                    await w.insertBulk([mk('first'), mk('keep')])
                    let n = 0
                    //cloneDeep只複製陣列索引並以子類別建構, 故主鍵與name以類別getter提供(原型鏈上之存取器)
                    class Row extends Array {
                        get id() {
                            n++
                            return n === 1 ? first : 'keep'
                        }

                        set id(v) {}

                        get name() {
                            return 'after'
                        }
                    }
                    let r = new Row()
                    r.push('slot')
                    let rs = await w.save([r]).catch((e) => e)
                    if (first === undefined) {
                        assert.strict.strictEqual(msgOf(rs), 'invalid data[0].id, autoGenPk is false')
                    }
                    else {
                        assert.strict.deepStrictEqual(rs, [{ n: 1, nInserted: 0, nModified: 1, ok: 1 }])
                    }
                    let rows = Object.fromEntries((await w.select()).map((v) => [v.id, v.name]))
                    assert.strict.strictEqual(rows.keep, 'n', 'keep不得被更新')
                    assert.strict.strictEqual(n, 1, '存取器只讀一次')
                }
            })

            it('外層批次為Array之子類別並自訂Symbol.species: 批次不得靜默變成零筆', async function() {
                class Rows extends Array {
                    static get [Symbol.species]() {
                        return Uint8Array
                    }
                }
                for (let api of ['insert', 'insertBulk', 'save']) {
                    let { w } = freshWo(ctx, {})
                    let rows = new Rows()
                    rows.push(mk('one', { name: 'a' }), mk('two', { name: 'b' }))
                    await w[api](rows)
                    assert.strict.deepStrictEqual(await ids(w), ['one', 'two'], api)
                }
                let { w } = freshWo(ctx, {})
                await w.insertBulk([mk('one'), mk('two')])
                let rows = new Rows()
                rows.push(mk('one'), mk('two'))
                assert.strict.deepStrictEqual(await w.del(rows), [{ n: 1, nDeleted: 1, ok: 1 }, { n: 1, nDeleted: 1, ok: 1 }])
            })

            it('繼承而來之欄位值(原型上之陣列、getter回傳之陣列)亦與呼叫端分離: 呼叫後改動不影響寫入', async function() {
                for (let useStable of [true, false]) {
                    for (let src of ['proto-data', 'getter']) {
                        let { w } = freshWo(ctx, { useStable })
                        let shared = ['at-call']
                        let proto = {}
                        if (src === 'proto-data') {
                            proto.name = shared
                        }
                        else {
                            Object.defineProperty(proto, 'name', {
                                get() {
                                    return shared
                                },
                                enumerable: true,
                                configurable: true,
                            })
                        }
                        let d = Object.create(proto)
                        d.id = 'one'
                        let p = w.insert([d])
                        shared[0] = 'after-call'
                        await p
                        assert.strict.deepStrictEqual((await w.select()).map((v) => [v.id, v.name]), [['one', 'at-call']], `${src} useStable:${useStable}`)
                    }
                }
            })

            it('內建容器作為列(Map、Set): 不攤平, 其內容仍被檢核; 單一Map/Set輸入仍視為無資料(同修改前)', async function() {
                for (let mkc of [(h) => new Map([[h, 'v']]), (h) => new Map([['k', h]]), (h) => new Set([h])]) {
                    let { w } = freshWo(ctx, {})
                    let c = mkc(H)
                    c.id = 'ok1'
                    c.name = 'n'
                    let rej = await w.insertBulk([c]).catch((e) => e)
                    assert.strict.ok(/^invalid data: string contains lone surrogate at \[data\[0\]/.test(msgOf(rej)), msgOf(rej))
                    assert.strict.deepStrictEqual(await ids(w), [])
                }
                let { w } = freshWo(ctx, {})
                for (let single of [new Map([['x', 'v']]), new Set(['v'])]) {
                    for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                        let r = await w[api](single)
                        assert.strict.ok(Array.isArray(r) ? r.length === 0 : r.n === 0, `${api}: ${JSON.stringify(r)}`)
                    }
                }
                assert.strict.deepStrictEqual(await ids(w), [])
            })

            it('與model無關之getter不被讀為欄位: 拋錯者不使insert、save、del失敗(僅在欄位真被讀取時才拋出)', async function() {
                class R {
                    constructor(id) {
                        this.id = id
                        this.name = 'ok'
                    }

                    get unused() {
                        throw new Error('unused getter was evaluated')
                    }
                }
                let { w } = freshWo(ctx, {})
                await w.insert([new R('u1')])
                assert.strict.deepStrictEqual(await w.save([new R('u1')]), [{ n: 1, nInserted: 0, nModified: 0, ok: 1 }])
                assert.strict.deepStrictEqual(await w.del([new R('u1')]), [{ n: 1, nDeleted: 1, ok: 1 }])
                assert.strict.deepStrictEqual(await ids(w), [])
                //欄位本身之getter拋錯: 與修改前相同, 該次操作reject(寫入時讀取)
                class B {
                    constructor() {
                        this.id = 'b1'
                    }

                    get name() {
                        throw new Error('name getter boom')
                    }
                }
                let rej = await w.insert([new B()]).catch((e) => e)
                assert.strict.strictEqual(msgOf(rej), 'name getter boom')
                assert.strict.deepStrictEqual(await ids(w), [])
            })

            //第3輪(sol)補格

            it('內建容器之子類別與自訂Symbol.toStringTag之列: 主鍵存取器亦被攤平固定(以第一次為準), 容器內容仍被檢核', async function() {
                class MapRow extends Map {
                    constructor(first) {
                        super()
                        this.n = 0
                        this.first = first
                    }

                    get id() {
                        this.n++
                        return this.n === 1 ? this.first : 'keep'
                    }

                    set id(v) {}

                    get name() {
                        return 'after'
                    }
                }
                class TagRow {
                    constructor(first) {
                        this.n = 0
                        this.first = first
                    }

                    get [Symbol.toStringTag]() {
                        return 'Record'
                    }

                    get id() {
                        this.n++
                        return this.n === 1 ? this.first : 'keep'
                    }

                    get name() {
                        return 'after'
                    }
                }
                for (let Cls of [MapRow, TagRow]) {
                    for (let api of ['save', 'del']) {
                        let { w } = freshWo(ctx, { autoGenPk: false })
                        await w.insertBulk([mk('wanted', { name: 'before' }), mk('keep', { name: 'keep-before' })])
                        let r = await w[api]([new Cls('wanted')]).catch((e) => e)
                        assert.strict.ok(!(r instanceof Error), `${Cls.name} ${api}: ${msgOf(r)}`)
                        let rows = Object.fromEntries((await w.select()).map((v) => [v.id, v.name]))
                        assert.strict.strictEqual(rows.keep, 'keep-before', `${Cls.name} ${api}: keep不得被更新或刪除`)
                        if (api === 'save') {
                            assert.strict.strictEqual(rows.wanted, 'after', `${Cls.name} save`)
                        }
                        else {
                            assert.strict.strictEqual(rows.wanted, undefined, `${Cls.name} del`)
                        }
                    }
                }
                //容器內容(Map之項目)仍被檢核
                let { w } = freshWo(ctx, {})
                let m = new MapRow('x1')
                m.set('k', H)
                let rej = await w.insert([m]).catch((e) => e)
                assert.strict.ok(/^invalid data: string contains lone surrogate at \[data\[0\]/.test(msgOf(rej)), msgOf(rej))
                assert.strict.deepStrictEqual(await ids(w), [])
            })

            it('類別列之欄位值為Error、函式、Promise: 與純物件列寫入相同之值(不被改成[object Object]); 其內不良構內容仍被檢出', async function() {
                class R {
                    constructor(id, name) {
                        this.id = id
                        this.name = name
                    }
                }
                for (let mkv of [() => new Error('ok'), () => function f() {}, () => Promise.resolve(1)]) {
                    let { w } = freshWo(ctx, {})
                    //getter回傳(繼承路徑, 非自有資料屬性)
                    class G {
                        constructor(id, v) {
                            this.id = id
                            this.v = v
                        }

                        get name() {
                            return this.v
                        }
                    }
                    await w.insert([mk('plain', { name: mkv() }), new R('klass', mkv()), new G('getter', mkv())])
                    let rows = Object.fromEntries((await w.select()).map((v) => [v.id, v.name]))
                    assert.strict.strictEqual(rows.klass, rows.plain, `類別列(自有欄位)與純物件列須寫入相同之值, plain=${rows.plain}`)
                    assert.strict.strictEqual(rows.getter, rows.plain, `類別列(getter回傳)與純物件列須寫入相同之值, plain=${rows.plain}`)
                }
                let { w } = freshWo(ctx, {})
                let rej = await w.insert([new R('bad1', new Error(`bad${H}`))]).catch((e) => e)
                assert.strict.strictEqual(msgOf(rej), `invalid data: ${WHY_LONE} at [data[0].name.message]`)
            })

            it('既有[無資料]判定先於攤平: 只有無關getter之類別實例、空Array子類別仍為零筆(同修改前)', async function() {
                class Metadata {
                    get meta() {
                        return 'no-model-fields'
                    }
                }
                class EmptyRow extends Array {}
                let { w } = freshWo(ctx, {})
                for (let input of [new Metadata(), new EmptyRow()]) {
                    for (let api of ['insert', 'insertBulk', 'save', 'del']) {
                        let r = await w[api](input)
                        assert.strict.ok(Array.isArray(r) ? r.length === 0 : r.n === 0, `${api}: ${JSON.stringify(r)}`)
                    }
                }
                assert.strict.deepStrictEqual(await ids(w), [])
            })

            it('選項為Proxy(僅有get陷阱、無has陷阱): 已知選項照常讀取一次, 不得靜默落回預設', async function() {
                let { fp } = freshWo(ctx, {})
                let reads = []
                let target = { url: 'mdb://:', db: 'worm', fdModels: ctx.fdModels, storage: fp }
                let px = new Proxy(target, {
                    get(t, k) {
                        reads.push(String(k))
                        return k === 'cl' ? 'twf' : t[k]
                    },
                })
                let w = wo(px)
                await w.insert([mk('px1')])
                assert.strict.deepStrictEqual(await ids(w), ['px1'])
                assert.strict.strictEqual(reads.filter((v) => v === 'cl').length, 1, 'cl只被讀一次')
            })

            it('不良構之鍵名不因其getter拋錯而被隱藏: 仍以<invalid key>拒收', async function() {
                let proto = {}
                Object.defineProperty(proto, `bad${H}`, {
                    get() {
                        throw new Error('unused')
                    },
                    enumerable: true,
                    configurable: true,
                })
                let d = Object.assign(Object.create(proto), { id: 'one', name: 'ok' })
                for (let api of ['insert', 'insertBulk']) {
                    let { w } = freshWo(ctx, {})
                    let rej = await w[api]([d]).catch((e) => e)
                    assert.strict.strictEqual(msgOf(rej), `invalid data: ${WHY_LONE} at [data[0].<invalid key>]`, api)
                    assert.strict.deepStrictEqual(await ids(w), [], api)
                }
            })

            it('同批另一列之主鍵不被寫入語句產生過程中之自訂toString改動(定為唯讀, 整批性錯誤, 不寫入任何一筆)', async function() {
                let { w } = freshWo(ctx, {})
                await w.insertBulk([mk('wanted', { name: 'before' }), mk('keep', { name: 'keep-before' }), mk('other', { name: 'o' })])
                let target = { id: 'wanted', name: 'target-after' }
                let first = {
                    id: 'other',
                    name: {
                        target,
                        toString() {
                            this.target.id = 'keep'
                            return 'trigger'
                        },
                    },
                }
                let rej = await w.save([first, target]).catch((e) => e)
                assert.strict.ok(rej instanceof Error, 'toString改動主鍵須使整批失敗(fail-closed)而非更新到他列')
                let rows = Object.fromEntries((await w.select()).map((v) => [v.id, v.name]))
                assert.strict.deepStrictEqual(rows, { wanted: 'before', keep: 'keep-before', other: 'o' }, '不得寫入任何一筆')
            })

            it('識別字之最後防線(escId): 孤立代理拋錯且不回顯值', function() {
                assert.strict.throws(() => escId(`t${H}`), (err) => err.message === `invalid identifier: ${WHY_LONE}`)
                assert.strict.throws(() => getSelectAll(`t${L}`), (err) => err.message === `invalid identifier: ${WHY_LONE}`)
                assert.strict.strictEqual(escId('ok'), '[ok]')
                assert.strict.strictEqual(escId('a\u{1F600}'), '[a\u{1F600}]')
            })

        })

        describe('訊息不回顯值(D6)', function() {

            it('超過255字元、型別不符、無效主鍵之訊息不含主鍵值', async function() {
                let big = 'longpk'.repeat(60)
                let { w } = freshWo(ctx, {})
                for (let api of ['insert', 'insertBulk']) {
                    let rej = await w[api]([mk('ok1'), mk(big)]).catch((e) => e)
                    assert.strict.ok(msgOf(rej).startsWith('invalid data[1].id'), `${api}: ${msgOf(rej)}`)
                    assert.strict.ok(!msgOf(rej).includes('longpk'), `${api}: 不得回顯主鍵值`)
                }
                let rs = await w.save([mk(big, { name: 'x' })])
                assert.strict.strictEqual(rs[0].ok, 0)
                assert.strict.ok(!rs[0].err.includes('longpk'), `save: ${rs[0].err}`)
                assert.strict.strictEqual(rs[0].err, 'can not save data[0].id, id exceeds 255 characters')
                let rd = await w.del([mk(big)])
                assert.strict.deepStrictEqual(rd, [{ n: 0, nDeleted: 0, ok: 1 }], '超過255字元之del仍為未命中(Jet專屬, 非良構性)')

                //型別不符: ipk為整數主鍵
                let { w: wi } = freshWo(ctx, { cl: 'ipk', pk: 'id' }, './test/assets/worm_pk_def.mdb')
                let rj = await wi.insert([{ id: 'secret-abc', name: 'x' }]).catch((e) => e)
                assert.strict.ok(msgOf(rj).includes('type mismatch') && !msgOf(rj).includes('secret'), msgOf(rj))
                let rdi = await wi.del([{ id: 'secret-abc' }, { name: 'no-pk' }])
                assert.strict.ok(rdi[0].err.includes('type mismatch') && !rdi[0].err.includes('secret'), rdi[0].err)
                assert.strict.strictEqual(rdi[1].err, 'invalid data[1].id', 'del: 未帶有效主鍵')
            })

            it('不良構輸入之訊息不含逸出或原樣之孤立代理', async function() {
                let { w } = freshWo(ctx, {})
                let rej = await w.insert([mk(H)]).catch((e) => e)
                let m = msgOf(rej)
                assert.strict.ok(!m.includes('\uD800') && !/ud800/i.test(m) && !m.includes('a'.concat('\\')), m)
                let rs = await w.save([mk(L)])
                assert.strict.ok(!rs[0].err.includes('\uDC00') && !/udc00/i.test(rs[0].err), rs[0].err)
            })

        })

        describe('pk欄名跟隨opt.pk(twfk: 主鍵欄名key)', function() {

            it('訊息路徑與檢核皆用opt.pk, 不寫死id', async function() {
                let { w } = freshWo(ctx, { cl: 'twfk', pk: 'key' })
                let rej = await w.insert([{ key: 'g0' }, { key: H }]).catch((e) => e)
                assert.strict.strictEqual(msgOf(rej), `invalid id: ${WHY_LONE} at [data[1].key]`)
                let rs = await w.save([{ key: H, name: 'x' }, { key: 'g1', name: 'y' }])
                assert.strict.deepStrictEqual([rs[0].ok, rs[0].err, rs[1].ok], [0, `invalid id: ${WHY_LONE} at [data[0].key]`, 1])
                let rd = await w.del([{ key: L }, { key: 'g1' }])
                assert.strict.deepStrictEqual([rd[0].ok, rd[0].err, rd[1].ok, rd[1].nDeleted], [0, `invalid id: ${WHY_LONE} at [data[0].key]`, 1, 1])
                assert.strict.strictEqual(await w.selectByPk(H), null)
            })

        })

        describe('autoGenPk為true: 呼叫端所給之孤立代理主鍵不得被自動產生之UUID取代', function() {

            it('insert、insertBulk reject; save該筆ok為0; 資料庫無任何新列', async function() {
                let { w } = freshWo(ctx, { autoGenPk: true })
                for (let api of ['insert', 'insertBulk']) {
                    let rej = await w[api]([mk(H)]).catch((e) => e)
                    assert.strict.ok(rej instanceof Error, api)
                }
                let rs = await w.save([mk(H)])
                assert.strict.strictEqual(rs[0].ok, 0)
                assert.strict.deepStrictEqual(await ids(w), [])
            })

        })

    })

}


describe('WOrmMdb wellformed 單一出處與接線站點掃描(R-WF-00)', function() {

    //readSrc, 讀原始碼並去除整行註解(//與JSDoc之*行), 令掃描只針對程式碼
    const readSrc = (fn) => fs.readFileSync(`./src/${fn}`, 'utf8').split(/\r?\n/).filter((v) => !/^\s*(\/\/|\*|\/\*)/.test(v)).join('\n')
    const count = (s, re) => (s.match(re) || []).length

    it('chkOrmStr、chkOrmData只在約定之站點呼叫, 無私有複本', function() {
        let w = readSrc('WOrmMdb.mjs')
        let p = readSrc('pk.mjs')
        let g = readSrc('getCmd.mjs')
        //WOrmMdb.mjs: 建構設定迴圈1處chkOrmStr、chkWf內1處chkOrmData
        assert.strict.strictEqual(count(w, /\bchkOrmStr\(/g), 2, 'WOrmMdb.mjs之chkOrmStr呼叫(建構檢核迴圈與flatRow之鍵名檢核)')
        assert.strict.strictEqual(count(w, /\bchkOrmData\(/g), 2, 'WOrmMdb.mjs之chkOrmData呼叫(chkWf內對攤平列與附帶之容器原物件各一)')
        assert.strict.strictEqual(count(p, /\bchkOrmStr\(/g), 2, 'pk.mjs之chkOrmStr呼叫(chkPkWf與normPk)')
        assert.strict.strictEqual(count(g, /\bchkOrmStr\(/g), 2, 'getCmd.mjs之chkOrmStr呼叫(escVal與escId最後防線)')
        for (let [fn, s] of [['WOrmMdb.mjs', w], ['pk.mjs', p], ['getCmd.mjs', g]]) {
            assert.strict.strictEqual(count(s, /isUnstorable|showPk/g), 0, `${fn}: 不得殘留私有判定或回顯輔助`)
            assert.strict.strictEqual(count(s, /isWellFormed|\\uD800-\\uDBFF/g), 0, `${fn}: 不得另寫孤立代理判定`)
        }
    })

    it('chkWf只被insert、insertBulk、save、del呼叫; 四個寫入函數不在函數內cloneDeep(改由snap於呼叫當下複製)', function() {
        let w = readSrc('WOrmMdb.mjs')
        assert.strict.strictEqual(count(w, /\bchkWf\(/g), 5, '定義1 + insert + insertBulk + save + del')
        let fns = ['insert', 'insertBulk', 'save', 'del']
        for (let fn of fns) {
            let i = w.indexOf(`async function ${fn}(`)
            assert.strict.ok(i > 0, fn)
            let j = w.indexOf('\n    }\n', i)
            let body = w.slice(i, j)
            assert.strict.strictEqual(count(body, /cloneDeep\(/g), 0, `${fn}內不得再cloneDeep`)
            assert.strict.strictEqual(count(body, /\bchkWf\(/g), 1, `${fn}須呼叫chkWf一次`)
        }
        assert.strict.strictEqual(count(w, /\bsnap\(/g), 8, 'useStable四個 + 非useStable四個(snap本身以let snap = (fn) =>定義)')
    })

    it('錯誤訊息不以主鍵值組成: 不得再有[${showPk(…)}]或[${…pk}]形式之回顯', function() {
        let w = readSrc('WOrmMdb.mjs')
        assert.strict.strictEqual(count(w, /\[\$\{showPk/g), 0)
        assert.strict.strictEqual(count(w, /\$\{opt\.pk\}\[\$\{/g), 0, '訊息不得以opt.pk[值]回顯')
    })

})
