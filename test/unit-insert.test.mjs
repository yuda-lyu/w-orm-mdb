import assert from 'assert'
import wo from '../src/WOrmMdb.mjs'
import { isWindows, setupStorage, cleanStorage, mkOpt, getRt } from './unit-setup.mjs'


//spec: 資料庫函數回傳定義計算.md 之 insert(data)
//僅於主鍵不存在時寫入, 已存在者跳過且不覆寫; n為輸入筆數, nInserted為實際插入筆數
//T7: [檢查主鍵不存在]與[寫入]由Jet之主鍵唯一約束原子完成


let nm = 'insert'
let ss = null

if (isWindows()) {
    describe('WOrmMdb insert', function() {

        let w = null

        before(function() {
            ss = setupStorage(nm)
            w = wo(mkOpt(ss.fpStorage))
            w.on('error', function() {})
        })

        beforeEach(async function() {
            await w.delAll()
        })

        after(function() {
            cleanStorage(ss.fdTmp)
        })

        it('全數為新數據時nInserted等於n', async function() {
            let res = await w.insert([
                { id: 'a', name: 'A', value: 1 },
                { id: 'b', name: 'B', value: 2 },
                { id: 'c', name: 'C', value: 3 },
            ])
            assert.strict.deepStrictEqual(res, { n: 3, nInserted: 3, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 3)
        })

        it('收單一物件亦正常處理', async function() {
            let res = await w.insert({ id: 'a', name: 'A', value: 1 })
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
        })

        it('主鍵已存在者跳過, 整批仍ok為1', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            let res = await w.insert([{ id: 'a', name: 'A-new', value: 9 }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 0, ok: 1 })
        })

        it('已存在者不覆寫既有內容', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            await w.insert([{ id: 'a', name: 'A-new', value: 9 }])
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A', value: 1 })
        })

        it('全數已存在而nInserted為0屬正常結果, 不得reject', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }, { id: 'b', name: 'B', value: 2 }])
            let rt = await getRt(w.insert([{ id: 'a' }, { id: 'b' }]))
            assert.strict.strictEqual(rt, 'resolve')
        })

        it('部份已存在時nInserted為實際插入筆數', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            let res = await w.insert([
                { id: 'a', name: 'A-new' },
                { id: 'b', name: 'B', value: 2 },
                { id: 'c', name: 'C', value: 3 },
            ])
            assert.strict.deepStrictEqual(res, { n: 3, nInserted: 2, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 3)
        })

        it('同批含重複主鍵時僅首筆計入nInserted', async function() {
            let res = await w.insert([
                { id: 'e', name: 'E1', value: 5 },
                { id: 'e', name: 'E2', value: 6 },
                { id: 'e', name: 'E3', value: 7 },
            ])
            assert.strict.deepStrictEqual(res, { n: 3, nInserted: 1, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 1)
        })

        it('同批重複主鍵時保留首筆內容', async function() {
            await w.insert([
                { id: 'e', name: 'E1', value: 5 },
                { id: 'e', name: 'E2', value: 6 },
            ])
            assert.strict.strictEqual((await w.selectByPk('e')).name, 'E1')
        })

        it('主鍵之已存在判定不分大小寫, 與Jet引擎一致', async function() {
            await w.insert([{ id: 'a', name: 'A', value: 1 }])
            let res = await w.insert([{ id: 'A', name: 'AX', value: 9 }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 0, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 1)
        })

        it('未給之欄位以NULL寫入而非漏欄', async function() {
            await w.insert([{ id: 'a', name: 'A' }])
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A', value: null })
        })

        it('非欄位之鍵被濾除而不致失敗', async function() {
            let res = await w.insert([{ id: 'a', name: 'A', value: 1, notAColumn: 'zz' }])
            assert.strict.deepStrictEqual(res, { n: 1, nInserted: 1, ok: 1 })
            assert.strict.deepStrictEqual(await w.selectByPk('a'), { id: 'a', name: 'A', value: 1 })
        })

        it('整批性錯誤以reject拋出而非靜默跳過', async function() {
            //value為DOUBLE欄位, 給予非數值字串會由Jet回報型別不符,
            //其非主鍵衝突故不得視為[已存在則跳過], 須為整批性錯誤
            let rt = await getRt(w.insert([{ id: 'a', name: 'A', value: 'not-a-number' }]))
            assert.strict.strictEqual(rt, 'reject')
        })

        describe('option.returnList', function() {

            it('兩種取值下之形狀', async function() {
                let rs = [{ id: 'a', name: 'A', value: 1 }]
                let rAgg = await w.insert(rs)
                assert.strict.ok(!Array.isArray(rAgg), '未給時回單一物件')
                assert.strict.deepStrictEqual(Object.keys(rAgg).sort(), ['n', 'nInserted', 'ok'])

                await w.delAll()
                let rList = await w.insert(rs, { returnList: true })
                assert.strict.ok(Array.isArray(rList), '開啟時回陣列')

                await w.delAll()
                let rFalse = await w.insert(rs, { returnList: false })
                assert.strict.ok(!Array.isArray(rFalse), '明確給false時回單一物件')
            })

            it('與輸入等長保序且對位正確', async function() {
                await w.insert([{ id: 'b', name: 'B', value: 2 }])
                let res = await w.insert([
                    { id: 'a', name: 'A' }, //新
                    { id: 'b', name: 'B-new' }, //已存在
                    { id: 'c', name: 'C' }, //新
                ], { returnList: true })
                assert.strict.strictEqual(res.length, 3, '須與輸入等長')
                assert.strict.deepStrictEqual(res, [
                    { n: 1, nInserted: 1, ok: 1 },
                    { n: 1, nInserted: 0, ok: 1 },
                    { n: 1, nInserted: 1, ok: 1 },
                ])
            })

            it('逐筆元素之鍵集合恰為{n,nInserted,ok}且無err', async function() {
                await w.insert([{ id: 'b', name: 'B' }])
                let res = await w.insert([{ id: 'a' }, { id: 'b' }], { returnList: true })
                res.forEach((v, k) => {
                    assert.strict.deepStrictEqual(Object.keys(v).sort(), ['n', 'nInserted', 'ok'], `第${k}筆`)
                    assert.strict.strictEqual(v.n, 1, '逐筆之n恆為1')
                    assert.strict.strictEqual(v.ok, 1, '逐筆之ok恆為1')
                })
            })

            it('同批重複主鍵僅首筆之nInserted為1', async function() {
                let res = await w.insert([
                    { id: 'e', name: 'E1' },
                    { id: 'e', name: 'E2' },
                    { id: 'e', name: 'E3' },
                ], { returnList: true })
                assert.strict.deepStrictEqual(res.map((v) => v.nInserted), [1, 0, 0])
            })

            it('filter計數等於聚合模式之nInserted', async function() {
                let rs = [
                    { id: 'a', name: 'A' },
                    { id: 'b', name: 'B' },
                    { id: 'b', name: 'B2' },
                    { id: 'c', name: 'C' },
                ]
                await w.insert([{ id: 'a', name: 'pre' }])
                let rList = await w.insert(rs, { returnList: true })

                await w.delAll()
                await w.insert([{ id: 'a', name: 'pre' }])
                let rAgg = await w.insert(rs)

                assert.strict.strictEqual(rList.filter((v) => v.nInserted === 1).length, rAgg.nInserted)
            })

            it('輸入無效時回[]', async function() {
                assert.strict.deepStrictEqual(await w.insert(null, { returnList: true }), [])
                assert.strict.deepStrictEqual(await w.insert({}, { returnList: true }), [])
                assert.strict.deepStrictEqual(await w.insert([], { returnList: true }), [])
            })

            it('change事件之res即本次實際回傳值', async function() {
                let evs = []
                let wc = wo(mkOpt(ss.fpStorage))
                wc.on('change', function(mode, data, res) {
                    evs.push({ mode, res })
                })
                wc.on('error', function() {})
                await wc.delAll()
                evs.length = 0

                let res = await wc.insert([{ id: 'a', name: 'A' }], { returnList: true })
                let ev = evs.find((v) => v.mode === 'insert')
                assert.strict.deepStrictEqual(ev.res, res)
                assert.strict.ok(Array.isArray(ev.res))
            })

            it('autoGenPk為false且未帶主鍵時仍為整批reject而不降為逐筆', async function() {
                let wf = wo(mkOpt(ss.fpStorage, { autoGenPk: false }))
                wf.on('error', function() {})
                assert.strict.strictEqual(await getRt(wf.insert({ name: 'no-id' }, { returnList: true })), 'reject')
            })

            it('整批性錯誤時仍reject而不降為逐筆', async function() {
                let rt = await getRt(w.insert([
                    { id: 'a', name: 'A', value: 1 },
                    { id: 'b', name: 'B', value: 'not-a-number' },
                ], { returnList: true }))
                assert.strict.strictEqual(rt, 'reject')
            })

        })

        it('大批次插入之筆數精確', async function() {
            let rs = []
            for (let i = 0; i < 300; i++) {
                rs.push({ id: `k${i}`, name: `N${i}`, value: i })
            }
            let res = await w.insert(rs)
            assert.strict.deepStrictEqual(res, { n: 300, nInserted: 300, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 300)

            //再插一次全數已存在
            let res2 = await w.insert(rs)
            assert.strict.deepStrictEqual(res2, { n: 300, nInserted: 0, ok: 1 })
            assert.strict.strictEqual((await w.select()).length, 300)
        })

    })
}
